"""
tools/sync_audiences.py — mirror Meta's audience inventory into Postgres.

Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§4.2). Pulls Custom + Lookalike Audiences (single endpoint on Meta, split by
`subtype=='LOOKALIKE'`) plus Saved Audiences (separate endpoint) and upserts
them into `meta_audiences`. Audiences not in the latest response are marked
`archived_at` so historical references in `approvals` still resolve.

Idempotent: re-running produces no diff if nothing changed on Meta.

Output: a summary JSON `{business_id, synced_custom, synced_lookalike,
synced_saved, archived, errors}`.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _parse_meta_ts(v) -> datetime | None:
    """Meta returns timestamps as ISO 8601 strings (or unix int in some endpoints).
    Normalize to a tz-aware datetime so Postgres timestamptz columns store
    something meaningful."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, tz=timezone.utc)
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _to_jsonb(v):
    """psycopg adapts dicts/lists to jsonb automatically; passing strings as
    jsonb requires explicit casting which complicates the SQL. Stringify
    anything that isn't a dict/list/None to avoid surprises."""
    if v is None or isinstance(v, (dict, list)):
        return json.dumps(v) if v is not None else None
    return json.dumps(v)


def _upsert_audience(cur, business_id: str, kind: str, row: dict) -> None:
    """Upsert one audience row. `row` is a JSON-safe dict from MetaClient."""
    meta_id = row.get("id")
    if not meta_id:
        return

    subtype = row.get("subtype")
    # Lookalike audiences come from get_custom_audiences with subtype='LOOKALIKE'
    # — the caller passes kind='lookalike' for those; subtype stays as
    # 'LOOKALIKE' so the UI can show it as a label.

    cur.execute(
        """
        INSERT INTO meta_audiences (
            business_id, meta_audience_id, kind, subtype, name, description,
            approximate_count_lower_bound, approximate_count_upper_bound,
            retention_days,
            data_source, rule, lookalike_spec, operation_status, delivery_status,
            permission_for_actions, origin_audience_id,
            time_created, time_updated, meta_raw,
            synced_at, archived_at
        )
        VALUES (
            %(business_id)s, %(meta_audience_id)s, %(kind)s, %(subtype)s,
            %(name)s, %(description)s,
            %(lower)s, %(upper)s,
            %(retention_days)s,
            %(data_source)s, %(rule)s, %(lookalike_spec)s,
            %(operation_status)s, %(delivery_status)s,
            %(permission_for_actions)s, %(origin_audience_id)s,
            %(time_created)s, %(time_updated)s, %(meta_raw)s,
            now(), NULL
        )
        ON CONFLICT (business_id, meta_audience_id) DO UPDATE SET
            kind = EXCLUDED.kind,
            subtype = EXCLUDED.subtype,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            approximate_count_lower_bound = EXCLUDED.approximate_count_lower_bound,
            approximate_count_upper_bound = EXCLUDED.approximate_count_upper_bound,
            retention_days = EXCLUDED.retention_days,
            data_source = EXCLUDED.data_source,
            rule = EXCLUDED.rule,
            lookalike_spec = EXCLUDED.lookalike_spec,
            operation_status = EXCLUDED.operation_status,
            delivery_status = EXCLUDED.delivery_status,
            permission_for_actions = EXCLUDED.permission_for_actions,
            origin_audience_id = EXCLUDED.origin_audience_id,
            time_created = COALESCE(EXCLUDED.time_created, meta_audiences.time_created),
            time_updated = EXCLUDED.time_updated,
            meta_raw = EXCLUDED.meta_raw,
            synced_at = now(),
            archived_at = NULL
        """,
        {
            "business_id": business_id,
            "meta_audience_id": str(meta_id),
            "kind": kind,
            "subtype": subtype,
            "name": row.get("name") or "(unnamed)",
            "description": row.get("description"),
            "lower": _to_int(row.get("approximate_count_lower_bound")),
            "upper": _to_int(row.get("approximate_count_upper_bound")),
            "retention_days": _to_int(row.get("retention_days")),
            "data_source": _to_jsonb(row.get("data_source")),
            "rule": _to_jsonb(row.get("rule")),
            "lookalike_spec": _to_jsonb(row.get("lookalike_spec")),
            "operation_status": _to_jsonb(row.get("operation_status")),
            "delivery_status": _to_jsonb(row.get("delivery_status")),
            "permission_for_actions": _to_jsonb(row.get("permission_for_actions")),
            "origin_audience_id": row.get("origin_audience_id"),
            "time_created": _parse_meta_ts(row.get("time_created")),
            "time_updated": _parse_meta_ts(row.get("time_updated")),
            "meta_raw": _to_jsonb(row),
        },
    )


def _archive_missing(cur, business_id: str, seen_ids: set[str]) -> int:
    """Mark audiences not seen in the latest sync as archived.

    Returns rowcount affected. We compare against the FULL set of audiences
    visible to us — if Meta paginates and we capped the iteration, this could
    archive legitimate rows. The list_* methods cap at 200 by default which
    covers a typical SMB account; the cap is configurable per call.
    """
    if not seen_ids:
        # Defensive: don't archive everything if we got an empty response
        # (could be a token / scope issue, not a real "all gone" state).
        return 0
    cur.execute(
        """
        UPDATE meta_audiences
           SET archived_at = now()
         WHERE business_id = %s
           AND archived_at IS NULL
           AND meta_audience_id <> ALL(%s)
        """,
        (business_id, list(seen_ids)),
    )
    return cur.rowcount or 0


def _sync(business_id: str, limit: int) -> dict:
    """Pull from Meta + write to Postgres. Returns the summary dict."""
    from campaigner.lib.meta_client import MetaClient

    try:
        client = MetaClient()
    except ConfigError as e:
        emit_runtime_error(f"Meta config invalid: {e}", e)
        return {}  # unreachable

    errors: list[str] = []
    custom_rows: list[dict] = []
    saved_rows: list[dict] = []
    try:
        custom_rows = client.list_custom_audiences(limit=limit)
    except Exception as e:
        errors.append(f"list_custom_audiences failed: {e}")
    try:
        saved_rows = client.list_saved_audiences(limit=limit)
    except Exception as e:
        errors.append(f"list_saved_audiences failed: {e}")

    seen_ids: set[str] = set()
    synced_custom = 0
    synced_lookalike = 0
    synced_saved = 0

    def _do_writes():
        nonlocal synced_custom, synced_lookalike, synced_saved
        with get_connection() as conn, conn.cursor() as cur:
            for row in custom_rows:
                meta_id = row.get("id")
                if not meta_id:
                    continue
                seen_ids.add(str(meta_id))
                kind = "lookalike" if (row.get("subtype") == "LOOKALIKE") else "custom"
                _upsert_audience(cur, business_id, kind, row)
                if kind == "lookalike":
                    synced_lookalike += 1
                else:
                    synced_custom += 1
            for row in saved_rows:
                meta_id = row.get("id")
                if not meta_id:
                    continue
                seen_ids.add(str(meta_id))
                _upsert_audience(cur, business_id, "saved", row)
                synced_saved += 1

            archived = _archive_missing(cur, business_id, seen_ids)
        return archived

    try:
        archived = with_db_retry(_do_writes)
    except Exception as e:
        emit_runtime_error(f"DB write failed: {e}", e)
        return {}  # unreachable

    return {
        "business_id": business_id,
        "synced_custom": synced_custom,
        "synced_lookalike": synced_lookalike,
        "synced_saved": synced_saved,
        "archived": archived,
        "errors": errors,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Sync Custom/Saved/Lookalike audiences from Meta into meta_audiences."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max audiences per kind to pull (default 200; Meta typical cap).",
    )
    args = p.parse_args()

    try:
        Config.load().require_meta()
    except ConfigError as e:
        emit_validation_error(f"Meta config missing: {e}")
        return

    try:
        summary = _sync(args.business_id, args.limit)
    except Exception as e:
        emit_runtime_error(f"sync failed: {e}", e)
        return

    emit_success(summary)


if __name__ == "__main__":
    main()
