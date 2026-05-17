"""
tools/push_capi_events.py — CAPI-for-CRM event firing (Mastery v2 Phase C,
2026-05-17).

Closes the lead-quality feedback loop without a website Pixel. When the
operator grades a lead in /leads UI, this tool POSTs a server-to-server
event to Meta's Conversions API keyed on the original `lead_id`. Meta's
algorithm reads these `Lead` / `Qualified` / `Customer` events and reweights
bidding toward people whose profiles match the high-grade leads — the
purpose-built path for Lead Ads (no website conversion needed).

Trigger model:
- Runs as a background sweep (cron every ~15 min via runners/push_capi_events.sh)
- Picks leads where capi_events_pushed array is missing the events implied by
  their current grade state, fires them, records the response.

Event semantics (per Meta Conversions API for CRM docs):
- Lead       — any grade (the lead exists, was real-enough to grade)
- Qualified  — grade >= 4
- Customer   — converted = true

All events keyed on event_id = `lead_id` so Meta dedups across re-runs.

Contract: §11.6 (JSON stdout, exit 0/1/2). Reads METAS_CAPI_PIXEL_ID +
META_ACCESS_TOKEN from env via lib/config.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import time
import urllib.error
import urllib.request

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import execute, fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

CAPI_GRAPH_URL = "https://graph.facebook.com/v21.0"


def _sha256(s: str | None) -> str | None:
    """Meta CAPI requires PII fields to be SHA-256 hashed."""
    if not s:
        return None
    return hashlib.sha256(s.strip().lower().encode("utf-8")).hexdigest()


def _events_needed_for(grade: int | None, converted: bool | None) -> list[str]:
    """Map grade → required events. Includes Lead always once we have a grade."""
    if grade is None:
        return []
    events = ["Lead"]
    if grade >= 4:
        events.append("Qualified")
    if converted:
        events.append("Customer")
    return events


def _post_capi_event(
    pixel_id: str,
    access_token: str,
    event_name: str,
    event_id: str,
    event_time: int,
    email_hash: str | None,
    phone_hash: str | None,
) -> dict:
    """Single CAPI event POST. Returns {http_status, fbtrace_id?, error?}."""
    user_data: dict[str, list[str]] = {}
    if email_hash:
        user_data["em"] = [email_hash]
    if phone_hash:
        user_data["ph"] = [phone_hash]
    payload = {
        "data": [
            {
                "event_name": event_name,
                "event_time": event_time,
                "event_id": event_id,
                "action_source": "system_generated",
                "user_data": user_data or {"em": [_sha256("noop@aiweon.local")]},
            }
        ]
    }
    body = json.dumps(payload).encode("utf-8")
    url = f"{CAPI_GRAPH_URL}/{pixel_id}/events?access_token={access_token}"
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            body_text = resp.read().decode("utf-8", "replace")
        parsed = {}
        with contextlib.suppress(json.JSONDecodeError):
            parsed = json.loads(body_text)
        return {
            "http_status": status,
            "fbtrace_id": parsed.get("fbtrace_id"),
        }
    except urllib.error.HTTPError as e:
        return {
            "http_status": e.code,
            "error": e.read().decode("utf-8", "replace")[:500],
        }
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return {"http_status": 0, "error": str(e)[:500]}


def main() -> None:
    p = argparse.ArgumentParser(
        description="Push pending CAPI-for-CRM events back to Meta for graded leads.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Max leads to process per invocation (rate-limit safety).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip the actual Meta POST; report what would have been pushed.",
    )
    args = p.parse_args()

    try:
        cfg = Config.load()
        cfg.require_db()
        cfg.require_meta()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    pixel_id = getattr(cfg, "meta_capi_pixel_id", None) or getattr(
        cfg, "meta_pixel_id", None
    )
    access_token = getattr(cfg, "meta_access_token", None)
    if not pixel_id or not access_token:
        emit_validation_error(
            "META_CAPI_PIXEL_ID + META_ACCESS_TOKEN required (env or Config)"
        )
        return

    # Pull graded leads where the events implied by the current grade aren't
    # all in capi_events_pushed yet.
    try:
        leads = with_db_retry(
            lambda: fetch_all(
                """
                SELECT l.id, l.meta_lead_id, l.email, l.phone, l.meta_created_at,
                       l.capi_events_pushed,
                       g.grade, g.converted
                  FROM leads l
                  JOIN lead_latest_grade g ON g.lead_id = l.id
                 WHERE l.business_id = %s
                   AND l.archived_at IS NULL
                 ORDER BY g.graded_at DESC
                 LIMIT %s
                """,
                (args.business_id, args.limit * 3),  # over-fetch; filter below
            )
        )
    except Exception as e:
        emit_runtime_error(f"lead query failed: {e}", exc=e)
        return

    pushed: list[dict] = []
    skipped = 0

    for row in leads or []:
        existing = row.get("capi_events_pushed") or []
        existing_names = {
            e.get("event_name")
            for e in existing
            if isinstance(e, dict) and isinstance(e.get("event_name"), str)
        }
        needed = _events_needed_for(row.get("grade"), row.get("converted"))
        to_fire = [e for e in needed if e not in existing_names]
        if not to_fire:
            skipped += 1
            continue
        if len(pushed) >= args.limit:
            break
        event_time = int(
            row.get("meta_created_at").timestamp()
            if row.get("meta_created_at")
            else time.time()
        )
        email_hash = _sha256(row.get("email"))
        phone_hash = _sha256(row.get("phone"))
        new_records: list[dict] = []
        for event_name in to_fire:
            event_id = f"{row['meta_lead_id']}:{event_name}"
            if args.dry_run:
                resp = {"http_status": 0, "dry_run": True}
            else:
                resp = _post_capi_event(
                    pixel_id=pixel_id,
                    access_token=access_token,
                    event_name=event_name,
                    event_id=event_id,
                    event_time=event_time,
                    email_hash=email_hash,
                    phone_hash=phone_hash,
                )
            new_records.append(
                {
                    "event_name": event_name,
                    "pushed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    **resp,
                }
            )
        if not args.dry_run:
            merged = list(existing) + new_records
            try:
                with_db_retry(
                    lambda merged=merged, lead_id=row["id"]: execute(
                        "UPDATE leads SET capi_events_pushed = %s::jsonb WHERE id = %s",
                        (json.dumps(merged), lead_id),
                    )
                )
            except Exception as e:
                emit_runtime_error(f"lead update failed: {e}", exc=e)
                return
        pushed.append(
            {
                "lead_id": str(row["id"]),
                "meta_lead_id": row["meta_lead_id"],
                "events": new_records,
            }
        )

    emit_success(
        {
            "business_id": args.business_id,
            "pushed_leads_count": len(pushed),
            "skipped_already_done": skipped,
            "dry_run": args.dry_run,
            "pushed": pushed,
        }
    )


if __name__ == "__main__":
    main()
