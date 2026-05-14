"""
tools/check_marginal_return.py — did the last budget change actually move
results? Implements the §T2+ Pre-check 1 guard (decision-tree.md, 2026-05-12)
and guardrail §21 `marginal_return_check_before_scale_up` (guardrails.md).

Algorithm:
  1. Find the most recent executed budget-changing approval for this campaign
     within `--lookback-days` (default 14).
  2. If found, fetch insights for two equal-length windows around the event:
       pre  = [executed_at - days .. executed_at - 1]
       post = [executed_at      .. executed_at + days - 1]
     Default window = 7 days each side.
  3. Sum `conversion-class` action values in each window (purchase, lead,
     complete_registration, ... — see CONVERSION_ACTION_TYPES below).
  4. Compute delta_pct = (post - pre) / pre × 100.
  5. Pass the +10% threshold from Roi 2026-05-12 if delta_pct >= 10.

Output contract:
  {
    "campaign_id": "<id>",
    "last_event": { task_type, executed_at, old_budget, new_budget, magnitude_pct } | null,
    "pre_window":   { since, until, conversions, spend, impressions },
    "post_window":  { since, until, conversions, spend, impressions },
    "delta_conversions_pct": float | null,
    "delta_threshold_pct": 10.0,
    "passes_guard": bool,        // true when guard does NOT block (i.e. ok to scale)
    "block_reason": str | null,  // human-readable in Hebrew if blocked
    "diagnostic_only": bool,     // true when no prior event in window — agent allowed to scale
  }

The agent reads `passes_guard` for the gate decision and surfaces
`block_reason` in the rationale when applicable.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Action types that count as conversions for this tool. Sourced from Meta's
# action_type taxonomy (https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/).
# Anything not in this set (link_click, post_engagement, video_view, etc.) is
# upper-funnel and explicitly excluded — the guard cares about results, not
# attention.
CONVERSION_ACTION_TYPES = frozenset(
    [
        # Purchase events
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
        "omni_purchase",
        # Lead events
        "lead",
        "leadgen.other",
        "offsite_conversion.fb_pixel_lead",
        "onsite_conversion.lead_grouped",
        "onsite_conversion.messaging_conversation_started_7d",
        # Registration / signup
        "complete_registration",
        "offsite_conversion.fb_pixel_complete_registration",
        # App / trial / subscribe
        "subscribe",
        "start_trial",
        "submit_application",
    ]
)

DEFAULT_THRESHOLD_PCT = 10.0
BUDGET_TASK_TYPES = ("scale_up", "scale_down", "budget_change")


def _sum_conversions(rows: list[dict]) -> float:
    """Sum value across actions whose action_type is conversion-class."""
    total = 0.0
    for row in rows:
        actions = row.get("actions") or []
        for a in actions:
            atype = a.get("action_type")
            if atype in CONVERSION_ACTION_TYPES:
                try:
                    total += float(a.get("value", 0))
                except (TypeError, ValueError):
                    continue
    return total


def _sum_field(rows: list[dict], field: str) -> float:
    total = 0.0
    for row in rows:
        v = row.get(field)
        if v is None:
            continue
        try:
            total += float(v)
        except (TypeError, ValueError):
            continue
    return total


def _extract_magnitude(payload: dict | None) -> float | None:
    """Compute (new - old) / old × 100 from the approval payload.

    Looks for new_daily_budget_cents / old_daily_budget_cents (the standard
    propose_task payload for budget_change), or daily_budget_usd if the older
    shape is in use.
    """
    if not payload:
        return None
    pairs = [
        ("new_daily_budget_cents", "old_daily_budget_cents"),
        ("new_daily_budget_agorot", "old_daily_budget_agorot"),
        ("new_daily_budget_usd", "old_daily_budget_usd"),
    ]
    for new_k, old_k in pairs:
        new_v = payload.get(new_k)
        old_v = payload.get(old_k)
        if new_v is None or old_v is None:
            continue
        try:
            new_f = float(new_v)
            old_f = float(old_v)
            if old_f <= 0:
                return None
            return round((new_f - old_f) / old_f * 100, 2)
        except (TypeError, ValueError):
            continue
    # Fall back to magnitude_pct if propose_task wrote it directly.
    mag = payload.get("magnitude_pct")
    if mag is None:
        return None
    try:
        return float(mag)
    except (TypeError, ValueError):
        return None


def main() -> None:
    p = argparse.ArgumentParser(
        description="Check whether the last scale_up/scale_down for a campaign "
        "actually moved results — guards §T2+ from chasing zero-marginal scale."
    )
    p.add_argument("--business-id", required=True, help="UUID of the businesses row")
    p.add_argument(
        "--campaign-id",
        required=True,
        help="Meta campaign ID (used to filter approvals.target_id)",
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=14,
        help="How far back to look for a prior scale event (default 14, per guardrail §21).",
    )
    p.add_argument(
        "--window-days",
        type=int,
        default=7,
        help="Length of each comparison window pre/post the event (default 7).",
    )
    p.add_argument(
        "--threshold-pct",
        type=float,
        default=DEFAULT_THRESHOLD_PCT,
        help=f"Pass threshold for delta_conversions_pct (default {DEFAULT_THRESHOLD_PCT}, per Roi 2026-05-12).",
    )
    args = p.parse_args()

    if args.lookback_days <= 0 or args.lookback_days > 90:
        emit_validation_error(f"--lookback-days must be 1..90 (got {args.lookback_days})")
        return
    if args.window_days <= 0 or args.window_days > 30:
        emit_validation_error(f"--window-days must be 1..30 (got {args.window_days})")
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        row = with_db_retry(
            lambda: fetch_one(
                """
            SELECT task_type, executed_at, payload
            FROM approvals
            WHERE business_id = %s
              AND target_id = %s
              AND task_type = ANY(%s)
              AND status = 'executed'
              AND executed_at IS NOT NULL
              AND executed_at >= now() - make_interval(days => %s)
            ORDER BY executed_at DESC
            LIMIT 1
            """,
                (
                    args.business_id,
                    args.campaign_id,
                    list(BUDGET_TASK_TYPES),
                    args.lookback_days,
                ),
            )
        )
    except Exception as e:
        emit_runtime_error(f"approvals lookup failed: {e}", exc=e)
        return

    # No prior scale event in the lookback window → guard does not block.
    # This is the "first scale, give it a chance" case. Agent allowed to scale.
    if not row:
        emit_success(
            {
                "campaign_id": args.campaign_id,
                "last_event": None,
                "pre_window": None,
                "post_window": None,
                "delta_conversions_pct": None,
                "delta_threshold_pct": args.threshold_pct,
                "passes_guard": True,
                "block_reason": None,
                "diagnostic_only": True,
                "lookback_days": args.lookback_days,
            }
        )
        return

    executed_at_raw = row["executed_at"]
    if isinstance(executed_at_raw, datetime):
        executed_at = executed_at_raw.astimezone(UTC)
    else:
        # psycopg returns datetime, but be defensive.
        executed_at = datetime.fromisoformat(str(executed_at_raw)).astimezone(UTC)
    event_date: date = executed_at.date()
    today = datetime.now(UTC).date()

    # If the event is too recent to have a meaningful post-window, mark
    # diagnostic_only and pass — Meta needs time to redistribute spend, the
    # comparison would be measuring noise.
    if (today - event_date).days < args.window_days:
        emit_success(
            {
                "campaign_id": args.campaign_id,
                "last_event": {
                    "task_type": row["task_type"],
                    "executed_at": executed_at.isoformat(),
                    "magnitude_pct": _extract_magnitude(row.get("payload")),
                },
                "pre_window": None,
                "post_window": None,
                "delta_conversions_pct": None,
                "delta_threshold_pct": args.threshold_pct,
                "passes_guard": True,
                "block_reason": None,
                "diagnostic_only": True,
                "diagnostic_reason": "post_window_too_recent",
                "lookback_days": args.lookback_days,
            }
        )
        return

    pre_since = event_date - timedelta(days=args.window_days)
    pre_until = event_date - timedelta(days=1)
    post_since = event_date
    post_until = event_date + timedelta(days=args.window_days - 1)

    try:
        config = Config.load()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        pre_rows = client.fetch_insights(
            level="campaign",
            time_range={"since": pre_since.isoformat(), "until": pre_until.isoformat()},
            fields=["campaign_id", "spend", "impressions", "actions", "date_start", "date_stop"],
            filtering=[{"field": "campaign.id", "operator": "EQUAL", "value": args.campaign_id}],
        )
        post_rows = client.fetch_insights(
            level="campaign",
            time_range={"since": post_since.isoformat(), "until": post_until.isoformat()},
            fields=["campaign_id", "spend", "impressions", "actions", "date_start", "date_stop"],
            filtering=[{"field": "campaign.id", "operator": "EQUAL", "value": args.campaign_id}],
        )
    except Exception as e:
        emit_runtime_error(f"Meta insights fetch failed: {e}", exc=e)
        return

    pre_conversions = _sum_conversions(pre_rows)
    post_conversions = _sum_conversions(post_rows)

    if pre_conversions <= 0:
        # No baseline to compare against — agent should treat as "no signal"
        # rather than "guard passed". Pass with a diagnostic flag.
        delta_pct: float | None = None
        passes = True
        block_reason: str | None = None
        diagnostic_only = True
        diagnostic_reason = "pre_window_zero_conversions"
    else:
        delta_pct = round((post_conversions - pre_conversions) / pre_conversions * 100, 2)
        passes = delta_pct >= args.threshold_pct
        if passes:
            block_reason = None
        else:
            block_reason = (
                f"ההגדלה הקודמת ב-{executed_at.date().isoformat()} לא הזיזה "
                f"את כמות ההמרות ({post_conversions:.0f} בשבוע אחרי לעומת "
                f"{pre_conversions:.0f} בשבוע לפני — שינוי של {delta_pct:.1f}%). "
                f"להגדיל עכשיו = לזרוק עוד תקציב על אותו מצב."
            )
        diagnostic_only = False
        diagnostic_reason = None

    emit_success(
        {
            "campaign_id": args.campaign_id,
            "last_event": {
                "task_type": row["task_type"],
                "executed_at": executed_at.isoformat(),
                "magnitude_pct": _extract_magnitude(row.get("payload")),
            },
            "pre_window": {
                "since": pre_since.isoformat(),
                "until": pre_until.isoformat(),
                "conversions": pre_conversions,
                "spend": _sum_field(pre_rows, "spend"),
                "impressions": _sum_field(pre_rows, "impressions"),
            },
            "post_window": {
                "since": post_since.isoformat(),
                "until": post_until.isoformat(),
                "conversions": post_conversions,
                "spend": _sum_field(post_rows, "spend"),
                "impressions": _sum_field(post_rows, "impressions"),
            },
            "delta_conversions_pct": delta_pct,
            "delta_threshold_pct": args.threshold_pct,
            "passes_guard": passes,
            "block_reason": block_reason,
            "diagnostic_only": diagnostic_only,
            "diagnostic_reason": diagnostic_reason,
            "lookback_days": args.lookback_days,
        }
    )


if __name__ == "__main__":
    main()
