"""
tools/load_recent_actions_outcomes.py — closes the loop between "agent proposed X,
operator approved, action ran" and "what actually happened to the numbers."

The gap this closes (2026-05-13 PM):
Until now, when the agent proposed `scale_up` and it executed, the next run had
no way of knowing what happened to CPL / CTR / spend afterward. Each run was
stateless — same campaign assessed cold every morning. This tool stitches each
executed approval to its before/after Meta insights window so the agent reads
"on 2026-05-08 I proposed scale_up, it executed, CPL dropped 18%" as input.

Without this, the agent can't tell good calls from bad ones, and can't earn
trust by saying "the last scale_up worked — here's why this one will too."

This tool:
  1. Reads approvals with status='executed' and executed_at in last N days
     (default 30) for the business.
  2. For each, identifies the campaign_id from target_id (campaign-targeted)
     or from `agent_decisions.campaign_id` joined by run_id (account-targeted).
  3. Pulls Meta insights for the 7-day window BEFORE executed_at and the
     7-day window AFTER, and computes deltas on the metrics that matter for
     the task_type:
       - scale_up / scale_down / budget_change → spend, impressions, CPM, CPL
       - new_creative / redeploy_creative → CTR, hook_rate, CPL
       - expand_audience → CPM, reach, CPL
       - publish_* → engagement (organic; no paid delta)
  4. Returns a compact summary the agent reads — task_type, target, dates,
     "before → after" key metrics, computed delta_pct, and a coarse label
     (`improved` / `flat` / `regressed` / `insufficient_data`).

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Per-task_type metric of interest. Keeping this small + opinionated so the
# output stays prompt-readable. If the agent needs more, it can refetch.
_METRIC_FOR_TASK: dict[str, str] = {
    "scale_up": "cpl",
    "scale_down": "cpl",
    "budget_change": "cpl",
    "new_creative": "ctr",
    "redeploy_creative": "ctr",
    "expand_audience": "cpm",
    "boost_post": "ctr",
    "pause_campaign": "spend",  # negative-only — confirm pause held
    "resume_campaign": "spend",
}


def _safe_num(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_cpl(row: dict) -> float | None:
    """Spend / leads. Returns None if either is missing or leads == 0."""
    spend = _safe_num(row.get("spend"))
    if spend is None:
        return None
    actions = row.get("actions") or []
    leads: int | None = None
    for key in ("onsite_conversion.lead_grouped", "lead"):
        for a in actions:
            if a.get("action_type") == key:
                try:
                    leads = int(float(a.get("value") or 0))
                    break
                except (TypeError, ValueError):
                    continue
        if leads is not None:
            break
    if not leads:
        return None
    return round(spend / leads, 2)


def _extract_metric(row: dict, metric: str) -> float | None:
    if not row:
        return None
    if metric == "cpl":
        return _extract_cpl(row)
    if metric == "ctr":
        v = _safe_num(row.get("ctr"))
        return round(v, 3) if v is not None else None
    if metric == "cpm":
        v = _safe_num(row.get("cpm"))
        return round(v, 2) if v is not None else None
    if metric == "spend":
        v = _safe_num(row.get("spend"))
        return round(v, 2) if v is not None else None
    return None


def _classify_delta(metric: str, before: float | None, after: float | None) -> str:
    """Lower-is-better for cpl/cpm; higher-is-better for ctr/spend(when ramping)."""
    if before is None or after is None:
        return "insufficient_data"
    if before == 0:
        return "insufficient_data"
    delta_pct = (after - before) / before * 100
    threshold = 5  # ignore noise under 5%
    if metric in ("cpl", "cpm"):
        if delta_pct <= -threshold:
            return "improved"
        if delta_pct >= threshold:
            return "regressed"
        return "flat"
    # ctr / spend: higher is better
    if delta_pct >= threshold:
        return "improved"
    if delta_pct <= -threshold:
        return "regressed"
    return "flat"


def main() -> None:
    p = argparse.ArgumentParser(
        description="For each approval executed in the last N days, fetch before/after Meta "
        "insights and compute the delta on the task-relevant metric.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--days", type=int, default=30)
    p.add_argument(
        "--window-days",
        type=int,
        default=7,
        help="Half-window for before/after comparison. Default 7.",
    )
    args = p.parse_args()

    try:
        config = Config.load().require_db()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT id, task_type, target_kind, target_id, executed_at,
                       payload, rationale
                FROM approvals
                WHERE business_id = %s
                  AND status = 'executed'
                  AND executed_at > now() - (%s || ' days')::interval
                ORDER BY executed_at DESC
                """,
                (args.business_id, str(args.days)),
            )
        )
    except Exception as e:
        emit_runtime_error(f"executed-approvals fetch failed: {e}", exc=e)
        return

    outcomes: list[dict] = []
    for r in rows:
        task_type = r["task_type"]
        target_id = r.get("target_id")
        target_kind = r.get("target_kind")
        executed_at: datetime = r["executed_at"]
        metric = _METRIC_FOR_TASK.get(task_type)
        if not metric or not target_id or target_kind != "campaign":
            # Account-level + organic actions don't lend themselves to clean
            # before/after — they have no campaign-scoped insights to diff.
            # Still log them so the agent sees "I did publish_fb_post on
            # 2026-05-08" without numbers.
            outcomes.append(
                {
                    "approval_id": str(r["id"]),
                    "task_type": task_type,
                    "target_kind": target_kind,
                    "target_id": target_id,
                    "executed_on": executed_at.date().isoformat(),
                    "metric": None,
                    "before": None,
                    "after": None,
                    "delta_pct": None,
                    "outcome": "no_paid_delta_applicable",
                    "note": "task type or target_kind doesn't map to campaign-level insights diff",
                }
            )
            continue

        # Build the two windows. Meta date strings are 'YYYY-MM-DD'.
        before_end = executed_at - timedelta(days=1)
        before_start = executed_at - timedelta(days=args.window_days)
        after_start = executed_at + timedelta(days=1)
        after_end = executed_at + timedelta(days=args.window_days)
        now = datetime.now(UTC)
        if after_end > now:
            after_end = now
        before_tr = {
            "since": before_start.date().isoformat(),
            "until": before_end.date().isoformat(),
        }
        after_tr = {"since": after_start.date().isoformat(), "until": after_end.date().isoformat()}

        try:
            before_rows = client.fetch_insights(
                level="campaign",
                time_range=before_tr,
                date_preset=None,
                filtering=[{"field": "campaign.id", "operator": "EQUAL", "value": target_id}],
            )
            after_rows = client.fetch_insights(
                level="campaign",
                time_range=after_tr,
                date_preset=None,
                filtering=[{"field": "campaign.id", "operator": "EQUAL", "value": target_id}],
            )
        except Exception as e:
            outcomes.append(
                {
                    "approval_id": str(r["id"]),
                    "task_type": task_type,
                    "target_kind": target_kind,
                    "target_id": target_id,
                    "executed_on": executed_at.date().isoformat(),
                    "metric": metric,
                    "outcome": "meta_fetch_failed",
                    "error": str(e),
                }
            )
            continue

        b_row = before_rows[0] if before_rows else {}
        a_row = after_rows[0] if after_rows else {}
        before_val = _extract_metric(b_row, metric)
        after_val = _extract_metric(a_row, metric)
        delta_pct = None
        if before_val and after_val and before_val != 0:
            delta_pct = round((after_val - before_val) / before_val * 100, 1)
        # Detect interfering actions in the same after-window — actions on the
        # same campaign that ran within ±7 days of this one. If present, we
        # can't credit `this` action for the delta — could be either, or both.
        # Per personality non-negotiable #2 ("every claim needs a receipt"),
        # we surface the overlap so the agent doesn't write "scale_up improved
        # CPL by 18%" when in fact a new_creative landed the same week.
        interfering: list[dict] = []
        try:
            _tid = target_id
            _rid = r["id"]
            _bs = before_start.isoformat()
            _ae = after_end.isoformat()
            others = with_db_retry(
                lambda _tid=_tid, _rid=_rid, _bs=_bs, _ae=_ae: fetch_all(
                    """
                    SELECT id, task_type, executed_at
                      FROM approvals
                     WHERE business_id = %s
                       AND target_id = %s
                       AND id <> %s
                       AND status = 'executed'
                       AND executed_at IS NOT NULL
                       AND executed_at BETWEEN %s AND %s
                    """,
                    (
                        args.business_id,
                        _tid,
                        _rid,
                        _bs,
                        _ae,
                    ),
                )
            )
            for o in others or []:
                interfering.append(
                    {
                        "approval_id": str(o["id"]),
                        "task_type": o["task_type"],
                        "executed_on": o["executed_at"].date().isoformat()
                        if o.get("executed_at")
                        else None,
                    }
                )
        except Exception:
            # Don't fail the whole outcome read because of one DB hiccup —
            # surface the gap as `interference_check_failed` and continue.
            interfering = [{"error": "interference_check_failed"}]

        outcome_label = _classify_delta(metric, before_val, after_val)
        # If outcome looks meaningful but there's interference, downgrade
        # the confidence. The agent reads `attribution_confidence` and
        # avoids "X caused Y" when it's "low".
        attribution_confidence = "high"
        if interfering and outcome_label in ("improved", "regressed"):
            attribution_confidence = "low"
        elif outcome_label == "flat":
            attribution_confidence = "n/a"
        elif outcome_label in ("improved", "regressed"):
            attribution_confidence = "high"

        outcomes.append(
            {
                "approval_id": str(r["id"]),
                "task_type": task_type,
                "target_kind": target_kind,
                "target_id": target_id,
                "executed_on": executed_at.date().isoformat(),
                "metric": metric,
                "before": before_val,
                "after": after_val,
                "delta_pct": delta_pct,
                "outcome": outcome_label,
                "attribution_confidence": attribution_confidence,
                "interfering_actions": interfering,
                "window_days": args.window_days,
            }
        )

    summary = {
        "improved": sum(1 for o in outcomes if o.get("outcome") == "improved"),
        "flat": sum(1 for o in outcomes if o.get("outcome") == "flat"),
        "regressed": sum(1 for o in outcomes if o.get("outcome") == "regressed"),
        "insufficient_data": sum(1 for o in outcomes if o.get("outcome") == "insufficient_data"),
        "no_paid_delta_applicable": sum(
            1 for o in outcomes if o.get("outcome") == "no_paid_delta_applicable"
        ),
        "meta_fetch_failed": sum(1 for o in outcomes if o.get("outcome") == "meta_fetch_failed"),
    }
    emit_success(
        {
            "business_id": args.business_id,
            "lookback_days": args.days,
            "executed_action_count": len(outcomes),
            "summary": summary,
            "outcomes": outcomes,
        }
    )


if __name__ == "__main__":
    main()
