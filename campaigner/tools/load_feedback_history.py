"""
tools/load_feedback_history.py — surface real operator rejections so the agent
doesn't re-propose the same thing twice.

The gap this closes (2026-05-13 PM, after operator audit):
Until now, every `propose_task` was drafted from scratch. The agent never read
back rejections from the `approvals` table — it would re-propose the same
`set_kpi_target` / `new_campaign` / etc. every run, and operators saw the same
ignored feedback repeating.

This tool:
  1. Reads rejected approvals from the last N days (default 90).
  2. Filters out bulk-reset / system reasons (`reset_per_operator_request_*`,
     `anti_flood_*`, `tracking_unhealthy_*`) — these aren't human feedback.
  3. Groups what's left by `(task_type, target_kind, target_id)`.
  4. Emits a compact summary that fits in a prompt — the agent reads this in
     Flow A Step 1.6 and is bound by guardrail §37 `respect_prior_rejections`
     to either cite + differentiate, or skip.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import re

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Reasons that aren't meaningful human feedback. Treat them as housekeeping
# noise — the agent doesn't need to "learn" from them.
_BULK_REASON_PATTERNS = [
    re.compile(r"^reset_per_operator_request"),
    re.compile(r"^anti_flood"),
    re.compile(r"^tracking_unhealthy_proposal_already_pending"),
    re.compile(r"^expired_no_action"),
    re.compile(r"^superseded_by_run_"),
]


def _is_bulk_reason(reason: str | None) -> bool:
    if not reason:
        return True  # rejection without reason isn't actionable feedback
    r = reason.strip()
    if len(r) < 8:
        return True
    return any(rx.match(r) for rx in _BULK_REASON_PATTERNS)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Surface real operator rejections from the approvals table "
        "so the agent can address them in the next round.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=90,
        help="Look-back window in days (default 90). Older rejections are stale.",
    )
    p.add_argument(
        "--include-bulk",
        action="store_true",
        help="Include bulk-reset and system reasons (debug only — normally filtered).",
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT id, task_type, target_kind, target_id, urgency,
                       rejection_reason, payload, rationale, created_at,
                       approved_at, approved_by
                FROM approvals
                WHERE business_id = %s
                  AND status = 'rejected'
                  AND created_at > now() - (%s || ' days')::interval
                ORDER BY created_at DESC
                """,
                (args.business_id, str(args.days)),
            )
        )
    except Exception as e:
        emit_runtime_error(f"feedback history fetch failed: {e}", exc=e)
        return

    meaningful: list[dict] = []
    bulk_filtered = 0
    for r in rows:
        reason = r.get("rejection_reason")
        if _is_bulk_reason(reason) and not args.include_bulk:
            bulk_filtered += 1
            continue
        # Truncate fields that bloat the prompt. The agent doesn't need the
        # full original rationale to remember what was rejected — task_type +
        # target + the operator's reason carries the lesson.
        rationale = r.get("rationale") or ""
        rationale_excerpt = rationale[:200] + ("…" if len(rationale) > 200 else "")
        meaningful.append({
            "approval_id": str(r["id"]),
            "task_type": r["task_type"],
            "target_kind": r.get("target_kind"),
            "target_id": r.get("target_id"),
            "urgency": r.get("urgency"),
            "rejected_on": r["created_at"].date().isoformat() if r.get("created_at") else None,
            "rejection_reason": (reason or "").strip(),
            "rationale_excerpt": rationale_excerpt,
        })

    # Group by (task_type, target_kind, target_id) so the agent sees "you
    # rejected scale_up on campaign 123 twice this month for related reasons"
    # as a pattern, not three isolated rows.
    grouped: dict[str, dict] = {}
    for m in meaningful:
        key = f"{m['task_type']}|{m['target_kind']}|{m['target_id']}"
        if key not in grouped:
            grouped[key] = {
                "task_type": m["task_type"],
                "target_kind": m["target_kind"],
                "target_id": m["target_id"],
                "rejection_count": 0,
                "rejections": [],
            }
        grouped[key]["rejection_count"] += 1
        grouped[key]["rejections"].append({
            "approval_id": m["approval_id"],
            "rejected_on": m["rejected_on"],
            "rejection_reason": m["rejection_reason"],
            "rationale_excerpt": m["rationale_excerpt"],
        })

    # Rank groups by recency × count so the agent sees the most actively-rejected
    # patterns first if the list is long.
    groups_sorted = sorted(
        grouped.values(),
        key=lambda g: (g["rejection_count"], g["rejections"][0]["rejected_on"] or ""),
        reverse=True,
    )

    emit_success({
        "business_id": args.business_id,
        "lookback_days": args.days,
        "total_rejections_in_window": len(rows),
        "meaningful_rejection_count": len(meaningful),
        "bulk_filtered_count": bulk_filtered,
        "groups": groups_sorted,
    })


if __name__ == "__main__":
    main()
