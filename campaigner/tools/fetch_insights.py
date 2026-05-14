"""
tools/fetch_insights.py — pull Meta insights snapshot.

Used by the observe phase of the daily observe-propose flow. Claude invokes
this first to get a fresh picture of account/campaign/adset/ad performance.

Exit codes per contract §11.6 (0 / 1 / 2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
)

VALID_LEVELS = ("account", "campaign", "adset", "ad")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch Meta insights snapshot for the observe phase.",
    )
    p.add_argument("--business-id", required=True, help="UUID of the businesses row")
    p.add_argument(
        "--level",
        choices=VALID_LEVELS,
        default="campaign",
        help="Aggregation level for insights (default: campaign)",
    )
    p.add_argument("--days", type=int, default=7, help="Lookback window in days (default: 7)")
    p.add_argument(
        "--fields",
        type=str,
        default=None,
        help="Comma-separated insights fields to request (optional; uses sensible defaults)",
    )
    p.add_argument(
        "--with-prior-window",
        action="store_true",
        help="Also fetch the prior equal-length window (days N..2N back) and "
        "merge into rows as *_current / *_prior / delta_*_pct. Used by §T2+ "
        "Pre-check 2 (marginal-CPM guard) and §T_SD trend detection.",
    )
    args = p.parse_args()

    if args.days <= 0 or args.days > 90:
        emit_validation_error(f"--days must be 1..90 (got {args.days})")

    fields = [f.strip() for f in args.fields.split(",")] if args.fields else None

    try:
        config = Config.load()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        if args.with_prior_window:
            rows = client.fetch_insights_with_prior_window(
                level=args.level,
                days=args.days,
                fields=fields,
            )
        else:
            rows = client.fetch_insights(
                level=args.level,
                date_preset=f"last_{args.days}d",
                fields=fields,
            )
    except Exception as e:
        emit_runtime_error(f"Meta insights fetch failed: {e}", exc=e)
        return

    emit_success(
        {
            "business_id": args.business_id,
            "level": args.level,
            "days": args.days,
            "fields": fields,
            "with_prior_window": args.with_prior_window,
            "row_count": len(rows),
            "rows": rows,
        }
    )


if __name__ == "__main__":
    main()
