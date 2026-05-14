"""
tools/fetch_meta_state.py — fetch object-level state (status, updated_time,
daily_budget, objective) for a campaign / adset / ad.

The `fetch_insights` endpoint does NOT expose these fields — it returns
performance metrics aggregated over a window. State fields live on the object
itself and require a separate API call.

Used by decision-tree §T0r:
  - R0 post_edit_cooldown (72h) → needs `updated_time`
  - R1/R2 LEARNING / LEARNING_LIMITED → needs `status` (object-level)
  - §T-1 utilization formula → needs `daily_budget`

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
)

VALID_OBJECT_TYPES = ("campaign", "adset", "ad")


def _hours_since(iso: str | None) -> float | None:
    """Convert an ISO timestamp string from Meta to hours-since-now (UTC).

    Meta returns e.g. '2026-05-10T14:23:00+0000'. Returns None when the input
    is missing or unparseable — the caller treats None as "unknown, skip the
    cooldown check."
    """
    if not iso:
        return None
    try:
        # Meta returns '+0000' suffix; Python 3.11+ fromisoformat handles it.
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    now = datetime.now(UTC)
    return round((now - dt).total_seconds() / 3600, 2)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch object-level state for a Meta campaign/adset/ad "
        "(status, updated_time, daily_budget, objective) — fields the "
        "insights endpoint doesn't expose.",
    )
    p.add_argument("--business-id", required=True, help="UUID of the businesses row (for logging context only — not used in the Meta call).")
    p.add_argument(
        "--object-type",
        required=True,
        choices=VALID_OBJECT_TYPES,
        help="campaign | adset | ad",
    )
    p.add_argument(
        "--object-id",
        required=True,
        help="Meta numeric ID (e.g. campaign_id 120244072777630443)",
    )
    p.add_argument(
        "--extra-fields",
        default=None,
        help="Comma-separated additional fields to request (rarely needed)",
    )
    args = p.parse_args()

    extra = (
        [f.strip() for f in args.extra_fields.split(",")] if args.extra_fields else None
    )

    try:
        config = Config.load()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        state = client.get_object_state(
            object_type=args.object_type,
            object_id=args.object_id,
            extra_fields=extra,
        )
    except Exception as e:
        emit_runtime_error(f"Meta object state fetch failed: {e}", exc=e)
        return

    # Compute the convenience field §T0r R0 actually needs. Without it, every
    # caller would re-implement the same parse → diff → round.
    hours_since_update = _hours_since(state.get("updated_time"))

    # Daily budget arrives as a string in cents (or agorot, since Meta stores
    # in account currency minor units). Cast to int when present.
    raw_budget = state.get("daily_budget")
    daily_budget_minor: int | None
    try:
        daily_budget_minor = int(raw_budget) if raw_budget is not None else None
    except (TypeError, ValueError):
        daily_budget_minor = None

    emit_success(
        {
            "business_id": args.business_id,
            "object_type": args.object_type,
            "object_id": args.object_id,
            "state": state,
            "hours_since_last_edit": hours_since_update,
            "daily_budget_minor_units": daily_budget_minor,
            "post_edit_cooldown_active": (
                hours_since_update is not None and hours_since_update < 72
            ),
        }
    )


if __name__ == "__main__":
    main()
