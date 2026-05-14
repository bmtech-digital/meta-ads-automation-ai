"""
tools/refresh_page_audience.py — refresh the `page_audience_signals` cache from
Meta's `/{page_id}/insights/page_fans_online_per_day`.

Runs on a weekly cadence (not on every observe-propose). The agent reads the
cached scores during §T9 (organic cadence) to pick `scheduled_for` at peak
audience-online hours, so we don't burn Graph quota on every proposal.

What it does, per business:
  1. Look up the selected Facebook Page + decrypted page access token.
  2. Call `lib/page_publishing.get_page_audience_online(...)` to get a
     hour_of_week → online_score dict (0..167).
  3. UPSERT one row per hour_of_week into `page_audience_signals`.

Contract: §11.6 (JSON stdout, exit 0/1/2). Reports counts of rows refreshed
per page.
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, get_connection
from campaigner.lib.page_publishing import PagePublishError, get_page_audience_online
from campaigner.lib.page_tokens import TokenLookupError, get_fb_publishing_target
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Refresh page_audience_signals from Meta page insights."
    )
    p.add_argument(
        "--business-id",
        help="Single business to refresh. Omit to refresh all active businesses with a selected Page.",
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Resolve which business_ids to process.
    if args.business_id:
        business_ids = [args.business_id]
    else:
        try:
            rows = with_db_retry(
                lambda: fetch_all(
                    """
                    SELECT b.id
                      FROM businesses b
                     WHERE b.active = true
                       AND b.meta_page_id IS NOT NULL
                    """,
                    None,
                )
            )
        except Exception as e:
            emit_runtime_error(f"businesses fetch failed: {e}", exc=e)
            return
        business_ids = [str(r["id"]) for r in rows]

    results: list[dict] = []
    for business_id in business_ids:
        try:
            page_id, page_token = get_fb_publishing_target(business_id)
        except TokenLookupError as e:
            results.append(
                {
                    "business_id": business_id,
                    "status": "skipped",
                    "reason": str(e),
                }
            )
            continue
        except Exception as e:
            results.append(
                {
                    "business_id": business_id,
                    "status": "error",
                    "reason": f"token resolve failed: {e}",
                }
            )
            continue

        try:
            grid = get_page_audience_online(page_id, page_token)
        except PagePublishError as e:
            results.append(
                {
                    "business_id": business_id,
                    "page_id": page_id,
                    "status": "error",
                    "reason": f"insights fetch failed: {e}",
                    "meta_code": e.code,
                }
            )
            continue

        try:
            inserted = with_db_retry(lambda: _upsert_grid(page_id, grid))
        except Exception as e:
            results.append(
                {
                    "business_id": business_id,
                    "page_id": page_id,
                    "status": "error",
                    "reason": f"upsert failed: {e}",
                }
            )
            continue

        results.append(
            {
                "business_id": business_id,
                "page_id": page_id,
                "status": "ok",
                "rows_upserted": inserted,
                "peak_hour_of_week": _peak_hour(grid),
            }
        )

    emit_success({"businesses_processed": len(business_ids), "results": results})


def _upsert_grid(page_id: str, grid: dict[int, int]) -> int:
    # One round-trip with VALUES — 168 rows per page. UPSERT updates existing
    # rows so re-running the tool is idempotent.
    rows = [(page_id, hw, score) for hw, score in grid.items()]
    with get_connection() as conn, conn.cursor() as cur:
        # psycopg3 supports COPY but for 168 rows a VALUES is simpler.
        # Build the parameter list and a $1,$2... placeholder string by hand.
        placeholders = ",".join(
            ["(%s, %s, %s, now())"] * len(rows)
        )
        flat_params: list = []
        for r in rows:
            flat_params.extend(r)
        sql = (
            f"INSERT INTO page_audience_signals "
            f"(page_id, hour_of_week, online_score, sampled_at) "
            f"VALUES {placeholders} "
            f"ON CONFLICT (page_id, hour_of_week) DO UPDATE SET "
            f"online_score = EXCLUDED.online_score, "
            f"sampled_at = EXCLUDED.sampled_at"
        )
        cur.execute(sql, flat_params)
        return cur.rowcount


def _peak_hour(grid: dict[int, int]) -> int | None:
    if not grid:
        return None
    return max(grid, key=lambda h: grid[h])


if __name__ == "__main__":
    main()
