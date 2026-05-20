"""
tools/load_active_plans.py — cross-run memory of forward-looking plans.

Per hebrew-copy-style §11 rule 6, every approved/executed proposal's
`rationale` ends with a `תוכנית:` block whose steps 2-3 are forward-looking
("אם הניצול עלה ל-95% — להציע scale_up"). This tool surfaces those steps
so the agent's next run has memory of conditional commitments it made.

After PRD step 5 (migration 032) the source of truth is `plans_carryover`
populated at propose-time via `propose_task --plan`. Step 5 also retired
the legacy regex-on-rationale path: any rationale whose author skipped
`--plan` simply has no structured plan to surface. The agent is now bound
to the structured commitment, not the prose.

For each pending, non-expired row this tool returns:
  - The Hebrew `action_text` (operator readback, identical to legacy rows)
  - The structured trigger (metric, operator, threshold_name, threshold_value,
    sustained_days) when present — populated for rows written via
    `propose_task --plan`. NULL for legacy rows from
    `lib.plans.persist_from_approval()`.
  - The proposed-action `task_type` + payload that would fire when the
    trigger evaluates true (also populated only for structured rows).

§39 `respect_active_plans` consumes the same output. The structured
fields are additive — a row without them still produces a valid plan
entry (the agent reads `action_text` like before).

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Surface forward-looking plan steps from prior approvals so the "
            "agent has cross-run memory of conditional commitments."
        ),
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=21,
        help=(
            "Only consider plans committed in the last N days. Default 21 "
            "(mirrors plans_carryover.expires_at default). Older plans are "
            "stale — the situation has changed enough that the conditional "
            "isn't meaningful anymore."
        ),
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
                SELECT pc.id AS plan_id, pc.source_approval_id,
                       pc.target_kind, pc.target_id,
                       pc.step_order, pc.action_text, pc.trigger_condition,
                       pc.trigger_metric, pc.trigger_operator,
                       pc.trigger_threshold_name, pc.trigger_threshold_value,
                       pc.trigger_sustained_days,
                       pc.proposed_action_payload, pc.proposed_action_task_type,
                       pc.owning_flow,
                       pc.committed_at, pc.expires_at,
                       a.task_type AS source_task_type
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
    structured_count = 0
    legacy_count = 0
    for r in rows or []:
        key = (r.get("target_kind"), r.get("target_id"))
        if key not in by_target:
            committed = r.get("committed_at")
            by_target[key] = {
                "approval_id": (
                    str(r["source_approval_id"]) if r.get("source_approval_id") else None
                ),
                "task_type": r.get("source_task_type"),
                "target_kind": r.get("target_kind"),
                "target_id": r.get("target_id"),
                "status": "approved_or_executed",
                "committed_on": committed.date().isoformat() if committed else None,
                "step_1_already_done": (
                    "(step 1 already executed — see source approval)"
                ),
                "forward_steps": [],
            }
        # Build the per-step entry. Structured trigger fields are surfaced
        # as a nested `structured_trigger` object when they're populated;
        # legacy rows just carry `action_text` + `trigger_condition`.
        step_dict: dict = {
            "plan_id": str(r["plan_id"]),
            "step_order": r["step_order"],
            "action_text": r["action_text"],
            "trigger_condition": r.get("trigger_condition"),
        }
        if r.get("trigger_metric") and r.get("trigger_operator"):
            structured_count += 1
            step_dict["structured_trigger"] = {
                "metric": r["trigger_metric"],
                "operator": r["trigger_operator"],
                "threshold_name": r.get("trigger_threshold_name"),
                "threshold_value": (
                    float(r["trigger_threshold_value"])
                    if r.get("trigger_threshold_value") is not None
                    else None
                ),
                "sustained_days": r.get("trigger_sustained_days"),
            }
            if r.get("proposed_action_payload") is not None:
                step_dict["proposed_action"] = {
                    "task_type": r.get("proposed_action_task_type"),
                    "payload": r["proposed_action_payload"],
                }
            step_dict["owning_flow"] = r.get("owning_flow")
        else:
            legacy_count += 1
        by_target[key]["forward_steps"].append(step_dict)
    plans.extend(by_target.values())

    emit_success(
        {
            "business_id": args.business_id,
            "lookback_days": args.days,
            "plan_count": len(plans),
            "plans": plans,
            "step_count_summary": {
                "structured": structured_count,
                "legacy_prose_only": legacy_count,
            },
        }
    )


if __name__ == "__main__":
    main()
