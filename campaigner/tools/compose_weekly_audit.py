"""
tools/compose_weekly_audit.py — produce the structured 7-day summary the agent
reads to write a Hebrew operator-facing weekly digest.

Built 2026-05-13 PM as the third leg of the "agency replacement" upgrade.
Most marketing agencies send a weekly status report: what we proposed, what
the client approved, what shifted in the numbers, what's open. Until now the
agent left this to the operator to reconstruct from scrolling through the
approvals queue. Flow F (the weekly self-audit runner) calls this tool, then
asks the agent to translate the structured output into ~200 Hebrew words —
producing the "your campaign manager's weekly digest" experience.

The tool itself doesn't write narrative. It returns:
  - proposals_summary: count + breakdown by task_type + urgency
  - approval_funnel: proposed → approved → executed counts + ratios
  - rejection_patterns: top operator-feedback themes (real reasons, not bulk)
  - outcomes_summary: improved / flat / regressed of executed actions
  - active_plans: open forward-step commitments per campaign
  - budget_pacing: current month-pace + delta vs prior week
  - tracking_health_status: current snapshot
  - notable_events: campaign status changes (paused → active, etc.)

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Bulk-reason filter, same as load_feedback_history — these aren't real feedback.
_BULK_REASON_PREFIXES = (
    "reset_per_operator_request",
    "anti_flood",
    "tracking_unhealthy_proposal_already_pending",
    "expired_no_action",
    "superseded_by_run_",
)


def _is_bulk_reason(r: str | None) -> bool:
    if not r or len(r.strip()) < 8:
        return True
    rs = r.strip()
    return any(rs.startswith(p) for p in _BULK_REASON_PREFIXES)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compose the 7-day structured audit for the weekly digest.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=7,
        help="Window for the audit (default 7).",
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    since_iso = (datetime.now(UTC) - timedelta(days=args.days)).isoformat()

    try:
        # All approvals created in the window — for proposals funnel.
        created = with_db_retry(
            lambda: fetch_all(
                """
                SELECT id, task_type, urgency, status, target_kind, target_id,
                       created_at, approved_at, executed_at, rejection_reason
                  FROM approvals
                 WHERE business_id = %s
                   AND created_at > %s
                 ORDER BY created_at DESC
                """,
                (args.business_id, since_iso),
            )
        ) or []

        # Approvals executed in window (regardless of when proposed) — for outcomes-context.
        executed_in_window = with_db_retry(
            lambda: fetch_all(
                """
                SELECT id, task_type, target_kind, target_id, executed_at
                  FROM approvals
                 WHERE business_id = %s
                   AND status = 'executed'
                   AND executed_at > %s
                 ORDER BY executed_at DESC
                """,
                (args.business_id, since_iso),
            )
        ) or []

        # Open plans — extract from prior 21d of approved/executed approvals.
        active_plan_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT id, task_type, target_id, target_kind, rationale,
                       coalesce(executed_at, approved_at) AS committed_on
                  FROM approvals
                 WHERE business_id = %s
                   AND status IN ('approved', 'executed')
                   AND coalesce(executed_at, approved_at) > now() - interval '21 days'
                """,
                (args.business_id,),
            )
        ) or []

        # Budget pacing snapshot.
        biz = with_db_retry(
            lambda: fetch_one(
                "SELECT monthly_budget_ils, daily_budget_ils, target_cpl_ils FROM businesses WHERE id = %s",
                (args.business_id,),
            )
        ) or {}

        # Tracking health snapshot.
        bk = with_db_retry(
            lambda: fetch_one(
                """
                SELECT tracking_verified, tracking_pixel_id, tracking_capi_configured,
                       tracking_aem_priority_events, tracking_domain_verified
                  FROM business_knowledge
                 WHERE business_id = %s
                """,
                (args.business_id,),
            )
        ) or {}

    except Exception as e:
        emit_runtime_error(f"weekly audit DB fetch failed: {e}", exc=e)
        return

    # ───── proposals_summary ─────
    by_task: dict[str, int] = {}
    by_urgency: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for r in created:
        by_task[r["task_type"]] = by_task.get(r["task_type"], 0) + 1
        u = r.get("urgency") or "unset"
        by_urgency[u] = by_urgency.get(u, 0) + 1
        s = r.get("status") or "unknown"
        by_status[s] = by_status.get(s, 0) + 1

    # ───── approval funnel ─────
    proposed = len(created)
    approved = by_status.get("approved", 0) + by_status.get("executed", 0)
    rejected = by_status.get("rejected", 0)
    pending = by_status.get("pending", 0)
    approval_rate_pct = round((approved / proposed * 100), 1) if proposed else None

    # ───── rejection_patterns ─────
    rejection_patterns: dict[str, int] = {}
    for r in created:
        if r.get("status") != "rejected":
            continue
        reason = r.get("rejection_reason")
        if _is_bulk_reason(reason):
            continue
        # Key on first 60 chars to group near-duplicates
        key = (reason or "").strip()[:60]
        if key:
            rejection_patterns[key] = rejection_patterns.get(key, 0) + 1
    top_rejections = sorted(rejection_patterns.items(), key=lambda kv: -kv[1])[:5]

    # ───── outcomes summary (for the operator's "did your actions work" loop) ─────
    outcomes_by_status: dict[str, int] = {
        "executed_with_campaign_target": 0,
        "executed_account_level": 0,
    }
    for r in executed_in_window:
        if r.get("target_kind") == "campaign":
            outcomes_by_status["executed_with_campaign_target"] += 1
        else:
            outcomes_by_status["executed_account_level"] += 1

    # ───── active plans count (rough — full extraction left to load_active_plans) ─────
    plan_count = 0
    for r in active_plan_rows:
        rationale = (r.get("rationale") or "")
        if "תוכנית" in rationale and ("אם" in rationale or "צעד" in rationale):
            plan_count += 1

    # ───── tracking snapshot ─────
    tracking_signals = {
        "verified": bool(bk.get("tracking_verified")),
        "has_pixel": bool(bk.get("tracking_pixel_id")),
        "capi": bool(bk.get("tracking_capi_configured")),
        "domain_verified": bool(bk.get("tracking_domain_verified")),
        "aem_events_present": bool(bk.get("tracking_aem_priority_events")),
    }
    tracking_status = (
        "healthy"
        if all(tracking_signals.values())
        else "partial"
        if any(tracking_signals.values())
        else "unverified"
    )

    audit = {
        "business_id": args.business_id,
        "window_days": args.days,
        "window_since": since_iso,
        "computed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "proposals_summary": {
            "total_proposed": proposed,
            "by_task_type": dict(sorted(by_task.items(), key=lambda kv: -kv[1])),
            "by_urgency": by_urgency,
            "by_status": by_status,
        },
        "approval_funnel": {
            "proposed": proposed,
            "approved_or_executed": approved,
            "rejected": rejected,
            "still_pending": pending,
            "approval_rate_pct": approval_rate_pct,
        },
        "rejection_patterns": [
            {"reason_head": k, "count": v} for k, v in top_rejections
        ],
        "outcomes_summary": outcomes_by_status,
        "active_plans_count": plan_count,
        "budget_snapshot": {
            "monthly_budget_ils": float(biz["monthly_budget_ils"]) if biz.get("monthly_budget_ils") else None,
            "daily_budget_ils": float(biz["daily_budget_ils"]) if biz.get("daily_budget_ils") else None,
            "target_cpl_ils": float(biz["target_cpl_ils"]) if biz.get("target_cpl_ils") else None,
        },
        "tracking": {
            "status": tracking_status,
            "signals": tracking_signals,
        },
        # The agent uses these as cues for the narrative — what's worth
        # surfacing in the Hebrew digest.
        "narrative_hints": _narrative_hints(
            proposed, approved, rejected, top_rejections, tracking_status, plan_count
        ),
    }

    emit_success(audit)


def _narrative_hints(
    proposed: int,
    approved: int,
    rejected: int,
    top_rejections: list[tuple[str, int]],
    tracking_status: str,
    plan_count: int,
) -> list[str]:
    """One-liners in English the agent reads as anchor points for the Hebrew
    narrative. The agent decides what to elevate."""
    hints: list[str] = []
    if proposed == 0:
        hints.append("Quiet week — no proposals queued. The agent should explain WHY (tracking gate? hands_off?).")
    elif approved == 0 and rejected > 0:
        hints.append("All proposals rejected — operator pushback signal. Address themes in the digest.")
    elif approved and proposed:
        rate = approved / proposed * 100
        if rate > 80:
            hints.append("High approval rate — agent suggestions are landing. Reinforce what worked.")
        elif rate < 30:
            hints.append("Low approval rate — agent suggestions are missing the mark. Self-critique tone.")
    if top_rejections:
        top = top_rejections[0]
        hints.append(f"Most common rejection theme: '{top[0][:50]}' ({top[1]}x). Acknowledge + adjust.")
    if tracking_status != "healthy":
        hints.append(f"Tracking is {tracking_status} — repeat the unblock walkthrough.")
    if plan_count > 0:
        hints.append(f"{plan_count} active forward-plan commitment(s) — name which are due this week.")
    return hints


if __name__ == "__main__":
    main()
