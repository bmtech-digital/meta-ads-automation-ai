"""
tools/check_creative_fatigue.py — compute Meta Creative Fatigue flag locally.

The Andromeda-era doctrine (per CAMPAIGN_EVALUATION.md §6 + performance-brain
§5) flags a creative as fatigued when its current Cost Per Result (CPR) is
≥ 2× the creative's own baseline CPR. Meta exposes this flag in Ads Manager
but the API doesn't return a stable field — so the agent computes it locally
by comparing two equal-length windows (default 7 days each) around now.

For each active creative on the business's ad account:
  1. Fetch insights for current window (last `days` days) at level=ad.
  2. Fetch insights for the prior window (days N..2N back).
  3. Sum conversion-class actions (purchase / lead / complete_registration /
     subscribe / start_trial — see CONVERSION_ACTION_TYPES below).
  4. CPR = spend / conversions for each window.
  5. fatigue_flag = current_cpr ≥ 2 × prior_cpr.

Threshold rationale: spec §5.3 "Meta Creative Fatigue flag" is +100% CPR per
Pilothouse + Tichenor 2026. Below 2× is normal variance.

Output (per creative + aggregate):
  {
    "business_id": "...",
    "window_days": 7,
    "creatives": [
      {
        "creative_id": "<meta_creative_id>",
        "ad_id": "<meta_ad_id>",
        "ad_name": "...",
        "current_window":  { since, until, spend, conversions, cpr },
        "prior_window":    { since, until, spend, conversions, cpr },
        "cpr_ratio":       2.1,
        "fatigue_flag":    true,
        "diagnostic_only": false,
        "diagnostic_reason": null
      },
      ...
    ],
    "fatigued_count": 1,
    "any_fatigue": true,
    "active_creative_count": 7,           -- creatives with impressions ≥ 100 in current window
    "active_with_impressions_count": 7    -- same value, surfaced for §T_PE threshold
  }

Used by decision-tree §T0r R4 (creative_refresh_candidate when fatigue_flag)
and §T_PE (when active_with_impressions_count < 5). Single tool covers both
signals since they share the same per-ad insights fetch.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
)

# Mirror of check_marginal_return.CONVERSION_ACTION_TYPES — kept duplicated
# on purpose (importing across tools couples them; the action taxonomy is
# stable and the comment on each tool calls out the source of truth).
CONVERSION_ACTION_TYPES = frozenset(
    [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
        "omni_purchase",
        "lead",
        "leadgen.other",
        "offsite_conversion.fb_pixel_lead",
        "onsite_conversion.lead_grouped",
        "onsite_conversion.messaging_conversation_started_7d",
        "complete_registration",
        "offsite_conversion.fb_pixel_complete_registration",
        "subscribe",
        "start_trial",
        "submit_application",
    ]
)

FATIGUE_RATIO_THRESHOLD = 2.0
MIN_IMPRESSIONS_ACTIVE = 100


def _sum_conversions(row: dict) -> float:
    actions = row.get("actions") or []
    total = 0.0
    for a in actions:
        if a.get("action_type") in CONVERSION_ACTION_TYPES:
            try:
                total += float(a.get("value", 0))
            except (TypeError, ValueError):
                continue
    return total


def _safe_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _index_by_creative(rows: list[dict]) -> dict[str, dict]:
    """Index level=ad insights rows by creative_id. Each ad has exactly one
    creative — Meta returns `creative_id` when the field is requested."""
    out: dict[str, dict] = {}
    for row in rows:
        cid = row.get("creative_id") or row.get("ad_id")
        if not cid:
            continue
        out[str(cid)] = row
    return out


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compute Meta Creative Fatigue flag locally (current CPR vs prior-window CPR ≥ 2×).",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=7,
        help="Length of each comparison window (default 7).",
    )
    p.add_argument(
        "--min-impressions",
        type=int,
        default=MIN_IMPRESSIONS_ACTIVE,
        help=f"Threshold for counting a creative as 'active' (default {MIN_IMPRESSIONS_ACTIVE}).",
    )
    args = p.parse_args()

    if args.days <= 0 or args.days > 30:
        emit_validation_error(f"--days must be 1..30 (got {args.days})")
        return

    try:
        config = Config.load()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    today = datetime.now(UTC).date()
    current_since = today - timedelta(days=args.days - 1)
    prior_until = current_since - timedelta(days=1)
    prior_since = prior_until - timedelta(days=args.days - 1)

    insight_fields = [
        "campaign_id",
        "ad_id",
        "ad_name",
        "impressions",
        "spend",
        "actions",
        "date_start",
        "date_stop",
    ]
    # creative_id isn't a native insights field — Meta exposes it via the ad
    # object. For MVP we use ad_id as the de-facto key per ad (each ad has
    # one creative; the agent dedupes by ad_id and joins to creative_gallery
    # via meta_creative_id when needed).

    try:
        current_rows = client.fetch_insights(
            level="ad",
            time_range={
                "since": current_since.isoformat(),
                "until": today.isoformat(),
            },
            fields=insight_fields,
        )
        prior_rows = client.fetch_insights(
            level="ad",
            time_range={
                "since": prior_since.isoformat(),
                "until": prior_until.isoformat(),
            },
            fields=insight_fields,
        )
    except Exception as e:
        emit_runtime_error(f"Meta insights fetch failed: {e}", exc=e)
        return

    prior_by_ad = _index_by_creative(prior_rows)

    creatives: list[dict] = []
    active_with_impressions = 0
    fatigued = 0

    for cur in current_rows:
        ad_id = str(cur.get("ad_id") or "")
        if not ad_id:
            continue
        cur_impressions = _safe_float(cur.get("impressions"))
        cur_spend = _safe_float(cur.get("spend"))
        cur_conv = _sum_conversions(cur)
        cur_cpr = cur_spend / cur_conv if cur_conv > 0 else None

        if cur_impressions >= args.min_impressions:
            active_with_impressions += 1

        prior = prior_by_ad.get(ad_id, {})
        prior_spend = _safe_float(prior.get("spend"))
        prior_conv = _sum_conversions(prior) if prior else 0.0
        prior_cpr = prior_spend / prior_conv if prior_conv > 0 else None

        cpr_ratio: float | None = None
        fatigue_flag = False
        diagnostic_only = False
        diagnostic_reason: str | None = None

        if cur_cpr is None:
            diagnostic_only = True
            diagnostic_reason = "current_window_zero_conversions"
        elif prior_cpr is None or not prior:
            diagnostic_only = True
            diagnostic_reason = "prior_window_zero_conversions" if prior else "no_prior_window_data"
        else:
            cpr_ratio = round(cur_cpr / prior_cpr, 3)
            fatigue_flag = cpr_ratio >= FATIGUE_RATIO_THRESHOLD

        if fatigue_flag:
            fatigued += 1

        creatives.append(
            {
                "ad_id": ad_id,
                "ad_name": cur.get("ad_name"),
                "campaign_id": cur.get("campaign_id"),
                "current_window": {
                    "since": current_since.isoformat(),
                    "until": today.isoformat(),
                    "impressions": cur_impressions,
                    "spend": round(cur_spend, 2),
                    "conversions": round(cur_conv, 2),
                    "cpr": round(cur_cpr, 2) if cur_cpr is not None else None,
                },
                "prior_window": {
                    "since": prior_since.isoformat(),
                    "until": prior_until.isoformat(),
                    "spend": round(prior_spend, 2),
                    "conversions": round(prior_conv, 2),
                    "cpr": round(prior_cpr, 2) if prior_cpr is not None else None,
                },
                "cpr_ratio": cpr_ratio,
                "fatigue_flag": fatigue_flag,
                "diagnostic_only": diagnostic_only,
                "diagnostic_reason": diagnostic_reason,
            }
        )

    emit_success(
        {
            "business_id": args.business_id,
            "window_days": args.days,
            "threshold_ratio": FATIGUE_RATIO_THRESHOLD,
            "min_impressions_active": args.min_impressions,
            "creatives": creatives,
            "creative_count_total": len(creatives),
            "active_with_impressions_count": active_with_impressions,
            "fatigued_count": fatigued,
            "any_fatigue": fatigued > 0,
        }
    )


if __name__ == "__main__":
    main()
