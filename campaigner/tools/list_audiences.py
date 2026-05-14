"""
tools/list_audiences.py — read the local `meta_audiences` mirror.

Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§4.2). Source of truth for Flow A Step 1, the web `/audiences` page, and the
`<AudiencePicker>` component. **Does not call Meta** — the mirror is populated
by `sync_audiences.py`. If the mirror is empty, the caller should trigger a
sync first.

Filters: `--kind` (custom/saved/lookalike/special_ad), `--subtype`,
`--include-archived`, `--min-count`. Default excludes archived rows.

Contract: §11.6 (single JSON on stdout).
"""

from __future__ import annotations

import argparse

from campaigner.lib.db import get_connection
from campaigner.tools._contract import emit_runtime_error, emit_success, with_db_retry


_FIELDS = [
    "id",
    "meta_audience_id",
    "kind",
    "subtype",
    "name",
    "description",
    "approximate_count_lower_bound",
    "approximate_count_upper_bound",
    "retention_days",
    "origin_audience_id",
    "operation_status",
    "delivery_status",
    "data_source",
    "rule",
    "lookalike_spec",
    "service_tag",
    "time_created",
    "time_updated",
    "synced_at",
    "archived_at",
]


def _query(
    business_id: str,
    *,
    kind: str | None,
    subtype: str | None,
    service_tag: str | None,
    include_archived: bool,
    min_count: int | None,
    limit: int,
) -> list[dict]:
    cols = ", ".join(_FIELDS)
    sql = f"SELECT {cols} FROM meta_audiences WHERE business_id = %s"
    params: list = [business_id]
    if not include_archived:
        sql += " AND archived_at IS NULL"
    if kind:
        sql += " AND kind = %s"
        params.append(kind)
    if subtype:
        sql += " AND subtype = %s"
        params.append(subtype)
    if service_tag is not None:
        # Block 13 (2026-05-13): per-service filter. Empty string means "no tag" —
        # surfaces synced audiences that haven't been assigned a service yet.
        if service_tag == "":
            sql += " AND service_tag IS NULL"
        else:
            sql += " AND lower(trim(service_tag)) = lower(trim(%s))"
            params.append(service_tag)
    if min_count is not None:
        # Use upper bound — gives the operator the optimistic estimate.
        sql += " AND COALESCE(approximate_count_upper_bound, 0) >= %s"
        params.append(min_count)
    sql += " ORDER BY kind, name LIMIT %s"
    params.append(limit)

    def _fetch():
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return cur.fetchall()

    return with_db_retry(_fetch)


def main() -> None:
    p = argparse.ArgumentParser(
        description="List audiences from the local meta_audiences mirror."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--kind",
        choices=["custom", "saved", "lookalike", "special_ad"],
        help="Filter to a specific audience kind.",
    )
    p.add_argument(
        "--subtype",
        help="Filter to a Meta subtype (e.g. WEBSITE, CUSTOMER_FILE, LOOKALIKE).",
    )
    p.add_argument("--include-archived", action="store_true")
    p.add_argument(
        "--min-count",
        type=int,
        help="Only return audiences whose upper-bound size >= this value. "
        "Use to filter out tiny audiences below Meta's LAL-seed threshold (100).",
    )
    p.add_argument(
        "--service-tag",
        default=None,
        help=(
            "Block 13 (2026-05-13): filter to audiences tagged for a specific "
            "service (business_knowledge.products[].name). Pass empty string to "
            "list untagged audiences (synced manually from Meta)."
        ),
    )
    p.add_argument("--limit", type=int, default=500)
    args = p.parse_args()

    try:
        rows = _query(
            args.business_id,
            kind=args.kind,
            subtype=args.subtype,
            service_tag=args.service_tag,
            include_archived=args.include_archived,
            min_count=args.min_count,
            limit=args.limit,
        )
    except Exception as e:
        emit_runtime_error(f"query failed: {e}", e)
        return

    summary = {
        "business_id": args.business_id,
        "count": len(rows),
        "by_kind": {},
        "by_service_tag": {},
        "audiences": rows,
    }
    for r in rows:
        k = r.get("kind") or "unknown"
        summary["by_kind"][k] = summary["by_kind"].get(k, 0) + 1
        tag = r.get("service_tag") or "_untagged_"
        summary["by_service_tag"][tag] = summary["by_service_tag"].get(tag, 0) + 1

    emit_success(summary)


if __name__ == "__main__":
    main()
