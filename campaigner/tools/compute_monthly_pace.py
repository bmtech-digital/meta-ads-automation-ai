"""
tools/compute_monthly_pace.py — Budget Health Check (Step 0 of Flow A).

Implements §17.7 per decisions-log §1.10. Claude runs this before diagnose
on every observe-propose invocation. The returned `status` drives whether the
flow continues as usual, pivots to `where_to_save`, or triggers §T10
(demand-driven raise).

Output shape:
{
  "business_id": "...",
  "today": "YYYY-MM-DD",
  "days_elapsed": int,                     -- 1..days_in_month
  "days_in_month": int,                    -- 28..31
  "days_left": int,                        -- days_in_month - days_elapsed
  "monthly_budget_ils": float | None,      -- raw
  "seasonal_multiplier": float,            -- product of active windows
  "active_windows": [...],                 -- for transparency in rationale
  "effective_monthly_budget": float,       -- monthly_budget * multiplier
  "spend_this_month": float,
  "avg_daily_spend_last_7d": float,
  "projected_monthly_spend": float,        -- spend_to_date + avg_7d * days_left
  "pace": float,                           -- actual/expected ratio, 0..∞
  "status": "ok" | "overrun" | "underrun" | "no_budget_set"
}

Pace semantics (§17.7):
  pace = spend_this_month / (effective_monthly_budget * days_elapsed / days_in_month)
  status:
    no_budget_set   → monthly_budget_ils is None/0; pace is undefined
    overrun         → pace > 1.10
    underrun        → pace < 0.7
    ok              → otherwise (includes 0.7..1.10)

Exit codes per contract §11.6 (0 / 1 / 2).
"""

from __future__ import annotations

import argparse
import calendar
from datetime import UTC, date, datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.lib.meta_client import MetaClient
from campaigner.lib.seasonal import effective_monthly_budget
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

OVERRUN_THRESHOLD = 1.10
UNDERRUN_THRESHOLD = 0.70


def _sum_spend(rows: list[dict]) -> float:
    total = 0.0
    for r in rows:
        spend = r.get("spend")
        if spend is None:
            continue
        try:
            total += float(spend)
        except (TypeError, ValueError):
            continue
    return total


def _classify(pace: float | None) -> str:
    if pace is None:
        return "no_budget_set"
    if pace > OVERRUN_THRESHOLD:
        return "overrun"
    if pace < UNDERRUN_THRESHOLD:
        return "underrun"
    return "ok"


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compute monthly budget pace + seasonal adjustment (Flow A Step 0).",
    )
    p.add_argument("--business-id", required=True, help="UUID of the businesses row")
    p.add_argument(
        "--as-of",
        default=None,
        help="Override today's date (YYYY-MM-DD) — for testing and replay. Default: current UTC date.",
    )
    args = p.parse_args()

    if args.as_of:
        try:
            today = date.fromisoformat(args.as_of)
        except ValueError:
            emit_validation_error(f"--as-of must be YYYY-MM-DD (got {args.as_of!r})")
            return
    else:
        today = datetime.now(UTC).date()

    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    days_left = days_in_month - days_elapsed

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        biz = with_db_retry(
            lambda: fetch_one(
                "SELECT monthly_budget_ils, seasonal_hints FROM businesses WHERE id = %s",
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"businesses lookup failed: {e}", exc=e)
        return

    if not biz:
        emit_validation_error(f"business_id {args.business_id} not found")
        return

    monthly_budget = biz.get("monthly_budget_ils")
    monthly_budget_f = float(monthly_budget) if monthly_budget is not None else None
    seasonal_hints = biz.get("seasonal_hints") or {}

    eff_budget, multiplier, active_w = effective_monthly_budget(
        monthly_budget_f, seasonal_hints, today
    )

    # Pull spend-to-date and last-7d from Meta at account level.
    month_start = today.replace(day=1).isoformat()
    try:
        config = Config.load()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        month_rows = client.fetch_insights(
            level="account",
            time_range={"since": month_start, "until": today.isoformat()},
            fields=["spend", "date_start", "date_stop"],
        )
        last7_rows = client.fetch_insights(
            level="account",
            date_preset="last_7d",
            fields=["spend", "date_start", "date_stop"],
        )
    except Exception as e:
        emit_runtime_error(f"Meta spend fetch failed: {e}", exc=e)
        return

    spend_month = _sum_spend(month_rows)
    spend_7d = _sum_spend(last7_rows)
    avg_daily_7d = spend_7d / 7.0 if spend_7d else 0.0
    projected_month = spend_month + avg_daily_7d * days_left

    if monthly_budget_f is None or monthly_budget_f == 0 or eff_budget == 0:
        pace: float | None = None
    else:
        expected_to_date = eff_budget * (days_elapsed / days_in_month)
        pace = (spend_month / expected_to_date) if expected_to_date > 0 else None

    status = _classify(pace)

    emit_success(
        {
            "business_id": args.business_id,
            "today": today.isoformat(),
            "days_elapsed": days_elapsed,
            "days_in_month": days_in_month,
            "days_left": days_left,
            "monthly_budget_ils": monthly_budget_f,
            "seasonal_multiplier": round(multiplier, 4),
            "active_windows": active_w,
            "effective_monthly_budget": round(eff_budget, 2),
            "spend_this_month": round(spend_month, 2),
            "avg_daily_spend_last_7d": round(avg_daily_7d, 2),
            "projected_monthly_spend": round(projected_month, 2),
            "pace": round(pace, 4) if pace is not None else None,
            "status": status,
            "thresholds": {
                "overrun_gt": OVERRUN_THRESHOLD,
                "underrun_lt": UNDERRUN_THRESHOLD,
            },
        }
    )


if __name__ == "__main__":
    main()
