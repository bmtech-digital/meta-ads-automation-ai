"""
tools/suggest_where_to_save.py — rank active campaigns by CPA/target and
return ordered pause/scale_down proposals until projected overage is covered.

Implements §17.7 "where-to-save" branch per decisions-log §1.10. Invoked by
Claude after `compute_monthly_pace.py` returns `status='overrun'`.

Contract:
  --projected-overage  float  how many ILS we need to save by month-end
  --days-left          int    days remaining in the month (to compute savings)
  --campaigns          json   list of {campaign_id, name?, cpa, target_cpa,
                              daily_budget_ils, days_over_target?}
                              — Claude assembles this from its fetch_insights
                              + diagnose step, same pattern as check_guardrails
                              taking --proposal inline.

Ranking: DESC by (cpa / target_cpa). Campaigns with CPA ≤ target × 1.2 are
never touched (§17.7: "don't touch performing").

Per-campaign action:
  CPA > target × 1.5 AND days_over_target >= 3   → pause_campaign
  CPA > target × 1.2                              → scale_down 30%
  else                                            → skip (performing)

Output shape:
{
  "projected_overage": <input>,
  "days_left": <input>,
  "ranked": [ {...campaign..., "ratio": float, "action": "pause|scale_down|skip",
               "estimated_savings_ils": float, "new_daily_budget_ils": float|null,
               "reason": str} ],
  "coverage": {
    "projected_overage": float,
    "total_suggested_savings": float,
    "remaining_uncovered": float,
    "fully_covered": bool,
    "all_performing": bool            -- true when no campaign met the CPA>1.2 bar
  }
}

Exit codes per contract §11.6 (0 / 1 / 2).
"""
from __future__ import annotations

import argparse

from campaigner.tools._contract import (
    emit_success,
    emit_validation_error,
    parse_json_arg,
)


PAUSE_RATIO = 1.5
SCALE_DOWN_RATIO = 1.2
SCALE_DOWN_PCT = 0.30
PAUSE_MIN_DAYS_OVER = 3


def _coerce_float(val, name: str, campaign_id: str) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        emit_validation_error(
            f"campaign {campaign_id!r} field {name!r} is not numeric: {val!r}"
        )
        return None  # unreachable


def _classify(ratio: float, days_over: int, daily_budget: float, days_left: int) -> dict:
    if ratio > PAUSE_RATIO and days_over >= PAUSE_MIN_DAYS_OVER:
        return {
            "action": "pause_campaign",
            "estimated_savings_ils": round(daily_budget * days_left, 2),
            "new_daily_budget_ils": None,
            "reason": (
                f"CPA/target ratio {round(ratio, 2)} > {PAUSE_RATIO} for "
                f"{days_over}+ days — pause stops the bleed for the {days_left} "
                f"days remaining in the month."
            ),
        }
    if ratio > SCALE_DOWN_RATIO:
        new_daily = round(daily_budget * (1 - SCALE_DOWN_PCT), 2)
        return {
            "action": "scale_down",
            "estimated_savings_ils": round(daily_budget * SCALE_DOWN_PCT * days_left, 2),
            "new_daily_budget_ils": new_daily,
            "reason": (
                f"CPA/target ratio {round(ratio, 2)} over {SCALE_DOWN_RATIO} — "
                f"reduce daily budget {SCALE_DOWN_PCT * 100:.0f}% ({daily_budget:.0f}→"
                f"{new_daily:.0f} ILS) without killing the campaign outright."
            ),
        }
    return {
        "action": "skip",
        "estimated_savings_ils": 0.0,
        "new_daily_budget_ils": None,
        "reason": (
            f"CPA/target ratio {round(ratio, 2)} ≤ {SCALE_DOWN_RATIO} — "
            f"performing within tolerance, leave alone."
        ),
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Rank campaigns by CPA/target and emit pause/scale_down proposals "
                    "until projected overage is covered.",
    )
    p.add_argument("--projected-overage", type=float, required=True,
                   help="ILS we need to save by month-end (from compute_monthly_pace).")
    p.add_argument("--days-left", type=int, required=True,
                   help="Days remaining in the current calendar month.")
    p.add_argument("--campaigns", required=True,
                   help="JSON list of active campaigns with CPA / target_cpa / daily_budget_ils.")
    args = p.parse_args()

    if args.projected_overage <= 0:
        emit_validation_error(f"--projected-overage must be positive (got {args.projected_overage})")
        return
    if args.days_left <= 0:
        emit_validation_error(f"--days-left must be positive (got {args.days_left})")
        return

    raw = parse_json_arg(args.campaigns, "campaigns")
    if not isinstance(raw, list):
        emit_validation_error("--campaigns must be a JSON array")
        return

    scored: list[dict] = []
    for c in raw:
        if not isinstance(c, dict):
            emit_validation_error(f"--campaigns entries must be objects (got {type(c).__name__})")
            return
        cid = c.get("campaign_id")
        if not cid:
            emit_validation_error("every campaign entry requires campaign_id")
            return
        cpa = _coerce_float(c.get("cpa"), "cpa", cid)
        target = _coerce_float(c.get("target_cpa"), "target_cpa", cid)
        daily = _coerce_float(c.get("daily_budget_ils"), "daily_budget_ils", cid)
        if cpa is None or target is None or daily is None:
            emit_validation_error(
                f"campaign {cid!r} is missing cpa / target_cpa / daily_budget_ils "
                "(required to rank)"
            )
            return
        if target <= 0:
            emit_validation_error(f"campaign {cid!r}: target_cpa must be > 0 (got {target})")
            return
        if cpa < 0 or daily < 0:
            emit_validation_error(f"campaign {cid!r}: cpa and daily_budget_ils must be ≥ 0")
            return
        days_over = int(c.get("days_over_target") or 0)
        ratio = cpa / target
        scored.append({
            "campaign_id": cid,
            "name": c.get("name"),
            "cpa": cpa,
            "target_cpa": target,
            "daily_budget_ils": daily,
            "days_over_target": days_over,
            "ratio": round(ratio, 4),
        })

    # Rank worst-CPA-first. Stable tie-break on daily_budget_ils DESC so bigger
    # burners get addressed before smaller ones at equal ratios.
    scored.sort(key=lambda x: (-x["ratio"], -x["daily_budget_ils"]))

    remaining = args.projected_overage
    ranked: list[dict] = []
    total_savings = 0.0
    for c in scored:
        decision = _classify(
            ratio=c["ratio"],
            days_over=c["days_over_target"],
            daily_budget=c["daily_budget_ils"],
            days_left=args.days_left,
        )
        applied = decision["action"] != "skip" and remaining > 0
        entry = {**c, **decision, "applied": applied}
        if applied:
            remaining -= decision["estimated_savings_ils"]
            total_savings += decision["estimated_savings_ils"]
        ranked.append(entry)

    all_performing = all(c["ratio"] <= SCALE_DOWN_RATIO for c in scored) if scored else True
    remaining_uncovered = max(0.0, args.projected_overage - total_savings)

    emit_success({
        "projected_overage": args.projected_overage,
        "days_left": args.days_left,
        "ranked": ranked,
        "coverage": {
            "projected_overage": args.projected_overage,
            "total_suggested_savings": round(total_savings, 2),
            "remaining_uncovered": round(remaining_uncovered, 2),
            "fully_covered": remaining_uncovered <= 0,
            "all_performing": all_performing,
        },
        "thresholds": {
            "pause_ratio_gt": PAUSE_RATIO,
            "pause_min_days_over": PAUSE_MIN_DAYS_OVER,
            "scale_down_ratio_gt": SCALE_DOWN_RATIO,
            "scale_down_pct": SCALE_DOWN_PCT,
        },
    })


if __name__ == "__main__":
    main()
