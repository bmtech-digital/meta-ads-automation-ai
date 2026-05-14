"""
tools/load_baselines.py — read persisted baselines.

Used by the diagnose phase to compare live snapshot values against rolling
baselines (spec §6.2 reactive 7/14/30-day windows).

Exit codes per contract §11.6 (0 / 1 / 2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.baselines import load_baselines
from campaigner.lib.config import Config, ConfigError
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

VALID_SCOPES = ("account", "campaign", "adset")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Load latest baseline values (one row per scope/metric/window).",
    )
    p.add_argument("--business-id", required=True, help="UUID of the businesses row")
    p.add_argument(
        "--scope",
        choices=VALID_SCOPES,
        default=None,
        help="Filter by scope (default: all scopes)",
    )
    p.add_argument("--metric", default=None, help="Filter by metric name (e.g. cpa, ctr)")
    p.add_argument(
        "--window-days",
        type=int,
        default=None,
        help="Filter by rolling window (typically 7, 14, or 30)",
    )
    args = p.parse_args()

    if args.window_days is not None and args.window_days <= 0:
        emit_validation_error(f"--window-days must be positive (got {args.window_days})")

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        rows = with_db_retry(
            lambda: load_baselines(
                business_id=args.business_id,
                scope=args.scope,
                metric=args.metric,
                window_days=args.window_days,
            )
        )
    except Exception as e:
        emit_runtime_error(f"Baseline load failed: {e}", exc=e)
        return

    emit_success(
        {
            "business_id": args.business_id,
            "filters": {
                "scope": args.scope,
                "metric": args.metric,
                "window_days": args.window_days,
            },
            "count": len(rows),
            "baselines": rows,
        }
    )


if __name__ == "__main__":
    main()
