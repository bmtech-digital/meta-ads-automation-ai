"""
tools/check_data_sufficiency.py — evaluate whether we have enough data to decide.

Per [performance-brain.md §3](../prompts/performance-brain.md) / spec §6.4:

  Gate 1 (creative-level, leading):
    ≥ 1,000 impressions AND ≥ 50 clicks per creative
  Gate 2 (campaign-level, lagging):
    ≥ 50 conversions in the last 7 days AND CPA stable 5-7 days
  Time-based safety floor:
    ≥ 48h since the last material change
  Emergency override:
    CPA > 3× target OR (spend ≥ daily budget AND 0 conversions for 3+ days)

This is a pure function over the given metrics — no DB, no Meta calls. Deterministic.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.tools._contract import (
    emit_success,
    emit_validation_error,
    parse_json_arg,
)

GATES = ("gate_1_creative", "gate_2_campaign", "emergency")


def _check_gate_1(m: dict) -> list[dict]:
    impressions = int(m.get("impressions", 0))
    clicks = int(m.get("clicks", 0))
    hours_live = float(m.get("hours_live", 0))
    return [
        {
            "name": "impressions_min_1000",
            "passed": impressions >= 1000,
            "value": impressions,
            "threshold": 1000,
        },
        {"name": "clicks_min_50", "passed": clicks >= 50, "value": clicks, "threshold": 50},
        {
            "name": "hours_live_min_48",
            "passed": hours_live >= 48,
            "value": hours_live,
            "threshold": 48,
        },
    ]


def _check_gate_2(m: dict) -> list[dict]:
    conversions_7d = int(m.get("conversions_7d", 0))
    days_since_change = float(m.get("days_since_material_change", 0))
    days_stable = int(m.get("days_cpa_stable", 0))
    return [
        {
            "name": "conversions_7d_min_50",
            "passed": conversions_7d >= 50,
            "value": conversions_7d,
            "threshold": 50,
        },
        {
            "name": "days_since_change_min_2",
            "passed": days_since_change >= 2,
            "value": days_since_change,
            "threshold": 2,
        },
        {
            "name": "days_cpa_stable_min_5",
            "passed": days_stable >= 5,
            "value": days_stable,
            "threshold": 5,
            "severity": "warning",
        },
    ]


def _check_emergency(m: dict) -> list[dict]:
    target_cpa = float(m.get("target_cpa_ils", 0) or 0)
    current_cpa = float(m.get("cpa_ils", 0) or 0)
    daily_spend = float(m.get("daily_spend_ils", 0) or 0)
    daily_budget = float(m.get("daily_budget_ils", 0) or 0)
    days_zero_conversions = int(m.get("days_zero_conversions", 0))

    cpa_3x = target_cpa > 0 and current_cpa >= target_cpa * 3
    burnout = daily_budget > 0 and daily_spend >= daily_budget and days_zero_conversions >= 3

    return [
        {
            "name": "cpa_3x_target",
            "triggered": cpa_3x,
            "current_cpa": current_cpa,
            "target_cpa": target_cpa,
        },
        {
            "name": "burnout_3d_zero_conversions",
            "triggered": burnout,
            "daily_spend": daily_spend,
            "daily_budget": daily_budget,
            "days_zero": days_zero_conversions,
        },
    ]


def main() -> None:
    p = argparse.ArgumentParser(
        description="Check whether a metrics snapshot passes the §6.4 data-sufficiency gates."
    )
    p.add_argument("--gate", required=True, choices=GATES)
    p.add_argument("--metrics", required=True, help="JSON object of metric values")
    args = p.parse_args()

    m = parse_json_arg(args.metrics, "metrics")
    if not isinstance(m, dict):
        emit_validation_error("--metrics must be a JSON object")
        return

    if args.gate == "gate_1_creative":
        checks = _check_gate_1(m)
        required_passed = all(c["passed"] for c in checks if c.get("severity") != "warning")
        emit_success(
            {
                "gate": args.gate,
                "sufficient": required_passed,
                "checks": checks,
                "action": "proceed_with_gate_1_evaluation"
                if required_passed
                else "skip_insufficient_data",
            }
        )

    elif args.gate == "gate_2_campaign":
        checks = _check_gate_2(m)
        required_passed = all(c["passed"] for c in checks if c.get("severity") != "warning")
        emit_success(
            {
                "gate": args.gate,
                "sufficient": required_passed,
                "checks": checks,
                "action": "proceed_with_gate_2_evaluation"
                if required_passed
                else "skip_insufficient_data",
            }
        )

    else:  # emergency
        checks = _check_emergency(m)
        any_triggered = any(c["triggered"] for c in checks)
        emit_success(
            {
                "gate": args.gate,
                "triggered": any_triggered,
                "checks": checks,
                "action": "emergency_proposal_urgent" if any_triggered else "no_emergency",
            }
        )


if __name__ == "__main__":
    main()
