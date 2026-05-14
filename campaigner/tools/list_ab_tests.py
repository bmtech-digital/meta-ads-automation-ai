"""
tools/list_ab_tests.py — list A/B tests for a business.

Block 11 (2026-05-13). The agent calls this in Flow A Step 1 to know which
tests are currently running, which are ready to decide (planned_end_at ≤
now), and which were recently decided/cancelled (for context).

Modes (via --status):
  - `running`           (default) — tests still gathering data
  - `ready_to_decide`   — running AND planned_end_at <= now
  - `decided`           — recent decisions (last 30 days)
  - `all`               — everything in the last 90 days

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

VALID_STATUS_MODES = ("running", "ready_to_decide", "decided", "all")


def main() -> None:
    p = argparse.ArgumentParser(
        description="List A/B tests for a business with their variant lists."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--status",
        choices=VALID_STATUS_MODES,
        default="running",
        help=(
            "running: still gathering data (default). "
            "ready_to_decide: running AND planned_end_at <= now. "
            "decided: recent decisions (last 30d). "
            "all: everything in the last 90d."
        ),
    )
    p.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Maximum tests to return (default 50).",
    )
    args = p.parse_args()

    if args.limit <= 0 or args.limit > 500:
        emit_validation_error(f"--limit must be 1..500 (got {args.limit})")
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Build the WHERE clause per mode. Same shape for all — partial differs.
    if args.status == "running":
        where = "status = 'running'"
    elif args.status == "ready_to_decide":
        where = "status = 'running' AND planned_end_at <= now()"
    elif args.status == "decided":
        where = "status IN ('decided','cancelled') AND decided_at >= now() - interval '30 days'"
    else:  # all
        where = "(status = 'running' OR (decided_at IS NOT NULL AND decided_at >= now() - interval '90 days'))"

    sql = f"""
        SELECT t.id::text AS id,
               t.campaign_id, t.adset_id, t.test_name,
               t.winner_metric, t.status,
               t.started_at::text, t.planned_end_at::text,
               t.decided_at::text, t.decision_reason,
               t.winner_creative_id, t.decision_snapshot,
               (
                 SELECT json_agg(
                   json_build_object(
                     'creative_id',          c.creative_id,
                     'variant_label',        c.variant_label,
                     'creative_gallery_id',  c.creative_gallery_id::text,
                     'added_at',             c.added_at::text
                   )
                   ORDER BY c.variant_label
                 )
                   FROM ab_test_creatives c
                  WHERE c.test_id = t.id
               ) AS variants
          FROM ab_tests t
         WHERE t.business_id = %s AND {where}
         ORDER BY
           CASE WHEN t.status = 'running' AND t.planned_end_at <= now()
                THEN 0  -- ready_to_decide pinned to top
                ELSE 1
           END,
           t.planned_end_at DESC NULLS LAST,
           t.created_at DESC
         LIMIT %s
    """

    try:
        rows = with_db_retry(lambda: fetch_all(sql, (args.business_id, args.limit)))
    except Exception as e:
        emit_runtime_error(f"ab_tests fetch failed: {e}", exc=e)
        return

    # Status counts in the SAME window — useful for the agent's planning
    # ("there are 3 running, 1 ready to decide, 2 decided last month").
    try:
        counts_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT status, COUNT(*)::int AS n
                  FROM ab_tests
                 WHERE business_id = %s
                   AND (status = 'running'
                        OR (decided_at IS NOT NULL
                            AND decided_at >= now() - interval '90 days'))
                 GROUP BY status
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"ab_tests counts fetch failed: {e}", exc=e)
        return
    counts: dict[str, int] = {"running": 0, "decided": 0, "cancelled": 0, "expired": 0}
    for r in counts_rows:
        counts[r["status"]] = r["n"]

    # Ready-to-decide subset count specifically (subset of running).
    try:
        ready_row = with_db_retry(
            lambda: fetch_all(
                """
                SELECT COUNT(*)::int AS n
                  FROM ab_tests
                 WHERE business_id = %s
                   AND status = 'running'
                   AND planned_end_at <= now()
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"ready-to-decide count failed: {e}", exc=e)
        return
    ready_to_decide_count = ready_row[0]["n"] if ready_row else 0

    emit_success(
        {
            "business_id": args.business_id,
            "status_filter": args.status,
            "count": len(rows),
            "by_status": counts,
            "ready_to_decide_count": ready_to_decide_count,
            "tests": rows,
        }
    )


if __name__ == "__main__":
    main()
