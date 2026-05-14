"""
tools/load_active_plans.py — lightweight cross-run memory of forward-looking plans.

Per hebrew-copy-style §11 rule 6 (added v0.4), every approved/executed proposal's
`rationale` ends with a `תוכנית:` block:

    תוכנית:
    1. [הפעולה הנוכחית — מה האישור הזה עושה]
    2. [צעד הבא — אם <תנאי> אז להציע <X>]
    3. [צעד שני הבא — אופציונלי]

Step 1 is the action that was approved. Steps 2-3 are forward-looking, often
conditional ("אם הניצול עלה ל-80% — להציע ..."). Until now this future-looking
plan vaporized at run-end: the next run started cold, with no memory that
"we said if utilization recovers above 80%, propose scale_up."

This tool fixes that with **soft memory** (no new table — minimal infrastructure):

  1. For each campaign that is still ACTIVE (or paused < 30 days), find the
     most recent approval that has a `תוכנית:` block in its rationale and
     was either executed or approved.
  2. Extract steps 2-3 (forward-looking) from the rationale text.
  3. Return them so the agent reads "for campaign X, on date Y, I committed
     to step 2: <text>" — and decides per-step whether the trigger condition
     is now met based on the live signals it already collected.

The agent cannot programmatically evaluate Hebrew conditional triggers like
"אם CPL ירד מתחת ל-150" — but it can read them, and the decision-tree §T0r
classification + step 2's condition together let the agent answer "yes, the
condition I set last week is now met" without us building a DSL.

For full plan-carryover (status tracking, automated trigger checks, structured
step data), migration 023+ would be needed. Soft memory is the v1 — earns trust
before we invest in heavier infrastructure.

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

# Match the תוכנית block — Hebrew letters + the asterisks markdown uses,
# tolerant of variants (with/without bold markers, with/without trailing colon).
# Capture everything from "תוכנית" to either end-of-string or next "אישור = "
# (per §11 rule 7 the footer comes after the plan).
_PLAN_HEADER_RX = re.compile(
    r"(?:\*\*)?תוכנית(?:\*\*)?\s*[:：]\s*",
)
_FOOTER_RX = re.compile(r"\n\s*אישור\s*[=—:]")

# A plan step: a numbered or bulleted line. We accept "1.", "1)", "1 -" or "• ".
_STEP_LINE_RX = re.compile(
    r"^\s*(?:(\d+)\s*[\.\):\-]|[•●▪\-])\s*(.+?)\s*$",
    re.MULTILINE,
)


def _extract_plan(rationale: str) -> list[str]:
    """Return the list of step-strings from a rationale's תוכנית block.

    Returns [] if no plan block is present, or if the block is empty/malformed."""
    if not rationale:
        return []
    m = _PLAN_HEADER_RX.search(rationale)
    if not m:
        return []
    after_header = rationale[m.end() :]
    # End the plan block at the "אישור =" footer if present
    footer_m = _FOOTER_RX.search(after_header)
    block = after_header[: footer_m.start()] if footer_m else after_header
    # Capture numbered/bulleted lines as steps. We keep only non-empty trims.
    steps = []
    for sm in _STEP_LINE_RX.finditer(block):
        text = sm.group(2).strip()
        # Strip trailing markdown asterisks
        text = re.sub(r"\*+$", "", text).strip()
        if text and len(text) > 4:  # filter accidental short lines
            steps.append(text)
        if len(steps) >= 5:  # plans are 1-3 steps; cap at 5 for safety
            break
    return steps


def main() -> None:
    p = argparse.ArgumentParser(
        description="Surface forward-looking plan steps from prior approvals, so "
        "the agent has cross-run memory of conditional commitments.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=21,
        help="Only consider approvals approved/executed in the last N days. Default 21. "
        "Older plans are stale — the situation has changed enough that the conditional "
        "isn't meaningful anymore.",
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # DB-first path (migration 023, 2026-05-13 PM): read plans_carryover
    # directly. This is more robust than re-running regex on every rationale
    # and exposes lifecycle (status: pending/triggered/superseded/expired).
    try:
        carryover_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT pc.id AS plan_id, pc.source_approval_id, pc.target_kind,
                       pc.target_id, pc.step_order, pc.action_text,
                       pc.trigger_condition, pc.status, pc.committed_at,
                       pc.expires_at, a.task_type
                  FROM plans_carryover pc
             LEFT JOIN approvals a ON a.id = pc.source_approval_id
                 WHERE pc.business_id = %s
                   AND pc.status = 'pending'
                   AND pc.expires_at > now()
                   AND pc.committed_at > now() - (%s || ' days')::interval
                 ORDER BY pc.committed_at DESC, pc.step_order ASC
                """,
                (args.business_id, str(args.days)),
            )
        )
    except Exception as e:
        emit_runtime_error(f"plans_carryover fetch failed: {e}", exc=e)
        return

    plans: list[dict] = []
    by_target: dict[tuple, dict] = {}
    for r in carryover_rows or []:
        key = (r.get("target_kind"), r.get("target_id"))
        if key not in by_target:
            committed = r.get("committed_at")
            by_target[key] = {
                "approval_id": str(r["source_approval_id"])
                if r.get("source_approval_id")
                else None,
                "task_type": r.get("task_type"),
                "target_kind": r.get("target_kind"),
                "target_id": r.get("target_id"),
                "status": "approved_or_executed",
                "committed_on": committed.date().isoformat() if committed else None,
                "step_1_already_done": "(from plans_carryover — step 1 already executed)",
                "forward_steps": [],
                "source": "plans_carryover",
            }
        step_dict = {
            "plan_id": str(r["plan_id"]),
            "step_order": r["step_order"],
            "action_text": r["action_text"],
            "trigger_condition": r.get("trigger_condition"),
        }
        by_target[key]["forward_steps"].append(step_dict)
    plans.extend(by_target.values())

    # Regex fallback for pre-migration approvals OR rationales whose plans
    # never persisted (e.g. execute_task errored mid-persist). Only include
    # targets we haven't already covered from the table.
    if plans is not None:
        try:
            fallback_rows = with_db_retry(
                lambda: fetch_all(
                    """
                    SELECT id, task_type, target_kind, target_id, rationale,
                           approved_at, executed_at, status
                    FROM approvals
                    WHERE business_id = %s
                      AND status IN ('approved', 'executed')
                      AND coalesce(executed_at, approved_at) > now() - (%s || ' days')::interval
                      AND id NOT IN (
                        SELECT source_approval_id FROM plans_carryover
                         WHERE business_id = %s AND source_approval_id IS NOT NULL
                      )
                    ORDER BY coalesce(executed_at, approved_at) DESC
                    """,
                    (args.business_id, str(args.days), args.business_id),
                )
            )
        except Exception:
            fallback_rows = []
        seen_targets = set(by_target.keys())
        for r in fallback_rows or []:
            key = (r.get("target_kind"), r.get("target_id"))
            if key in seen_targets:
                continue
            steps = _extract_plan(r.get("rationale") or "")
            if not steps:
                continue
            forward_steps = steps[1:] if len(steps) > 1 else []
            if not forward_steps:
                continue
            committed_on = r.get("executed_at") or r.get("approved_at")
            plans.append(
                {
                    "approval_id": str(r["id"]),
                    "task_type": r["task_type"],
                    "target_kind": r.get("target_kind"),
                    "target_id": r.get("target_id"),
                    "status": r["status"],
                    "committed_on": committed_on.date().isoformat() if committed_on else None,
                    "step_1_already_done": steps[0],
                    "forward_steps": [
                        {"action_text": s, "step_order": i + 2} for i, s in enumerate(forward_steps)
                    ],
                    "source": "regex_fallback",
                }
            )

    emit_success(
        {
            "business_id": args.business_id,
            "lookback_days": args.days,
            "plan_count": len(plans),
            "plans": plans,
            "source_summary": {
                "plans_carryover_table": sum(
                    1 for p in plans if p.get("source") == "plans_carryover"
                ),
                "regex_fallback": sum(1 for p in plans if p.get("source") == "regex_fallback"),
            },
        }
    )


if __name__ == "__main__":
    main()
