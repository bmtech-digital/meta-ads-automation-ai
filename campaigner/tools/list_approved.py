"""
tools/list_approved.py — fetch approvals with status='approved' for Flow B.

Ordered by urgency DESC, then created_at ASC (FIFO within urgency tier) so
Flow B executes the oldest urgent first.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(
        description="List approvals ready for execution (status='approved')."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--limit", type=int, default=50)
    args = p.parse_args()

    if args.limit <= 0 or args.limit > 500:
        emit_validation_error(f"--limit must be in (0, 500] (got {args.limit})")

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    urgency_rank = """
        CASE urgency
            WHEN 'urgent' THEN 4
            WHEN 'high'   THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low'    THEN 1
            ELSE 0
        END
    """

    # `scheduled_for IS NULL OR scheduled_for <= now()` keeps publish-style
    # approvals that should fire later (e.g. story at 20:00) out of the
    # executor's hands until their moment arrives. NULL means "as soon as
    # approved" — that's the existing behavior for ad-mutation task types.
    try:
        rows = with_db_retry(
            lambda: fetch_all(
                f"""
            SELECT id, business_id, created_by_run_id, task_type,
                   target_kind, target_id, payload, rationale,
                   expected_impact, urgency, status,
                   approved_at, approved_by, expires_at, created_at,
                   scheduled_for
            FROM approvals
            WHERE business_id = %s
              AND status = 'approved'
              AND (scheduled_for IS NULL OR scheduled_for <= now())
            ORDER BY {urgency_rank} DESC, created_at ASC
            LIMIT %s
            """,
                (args.business_id, args.limit),
            )
        )
    except Exception as e:
        emit_runtime_error(f"approvals fetch failed: {e}", exc=e)
        return

    emit_success(
        {
            "business_id": args.business_id,
            "count": len(rows),
            "approvals": rows,
        }
    )


if __name__ == "__main__":
    main()
