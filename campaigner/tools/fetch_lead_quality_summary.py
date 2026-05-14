"""
tools/fetch_lead_quality_summary.py — per-campaign lead quality aggregates.

Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§5). Read by Flow A Step 1.7 — every active campaign that has leads gets a
quality summary the agent uses in Gate 2 reasoning. Without this, "winner"
classification falls back to Meta-internal metrics only (the 16.4 trap).

Returns one row per campaign with leads in the window:
  {
    business_id,
    window_days,
    campaigns: [
      {
        campaign_id, campaign_name,
        leads_total, leads_graded, leads_ungraded,
        avg_grade, grade_distribution: {1: 2, 2: 1, 3: 5, ...},
        conversions, conversion_value_ils,
        quality_band: 'high' | 'mixed' | 'low' | 'insufficient_data',
        sample_lead_ids: [...]   -- first 5 ungraded leads for the operator's queue
      }
    ],
    overall: { ... same shape but business-wide ... }
  }

Quality band logic (the agent's Gate 2 input):
  - leads_total < 5            → insufficient_data
  - avg_grade >= 3.5           → high
  - avg_grade 2.5-3.49         → mixed
  - avg_grade < 2.5            → low

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from typing import Any

from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    with_db_retry,
)


def _band(leads_total: int, avg_grade: float | None) -> str:
    if leads_total < 5 or avg_grade is None:
        return "insufficient_data"
    if avg_grade >= 3.5:
        return "high"
    if avg_grade >= 2.5:
        return "mixed"
    return "low"


def _summarize(business_id: str, days: int) -> dict:
    def _fetch():
        with get_connection() as conn, conn.cursor() as cur:
            # Per-campaign aggregate
            cur.execute(
                """
                WITH window_leads AS (
                  SELECT l.id, l.meta_campaign_id, l.meta_ad_id
                    FROM leads l
                   WHERE l.business_id = %(biz)s
                     AND l.archived_at IS NULL
                     AND (
                       l.meta_created_at >= now() - make_interval(days => %(days)s)
                       OR l.meta_created_at IS NULL
                     )
                ),
                joined AS (
                  SELECT wl.meta_campaign_id, wl.id AS lead_id, g.grade,
                         g.converted, g.converted_value_ils
                    FROM window_leads wl
                    LEFT JOIN lead_latest_grade g ON g.lead_id = wl.id
                )
                SELECT meta_campaign_id,
                       COUNT(*) AS leads_total,
                       COUNT(grade) AS leads_graded,
                       AVG(grade)::float AS avg_grade,
                       SUM(CASE WHEN grade = 1 THEN 1 ELSE 0 END) AS g1,
                       SUM(CASE WHEN grade = 2 THEN 1 ELSE 0 END) AS g2,
                       SUM(CASE WHEN grade = 3 THEN 1 ELSE 0 END) AS g3,
                       SUM(CASE WHEN grade = 4 THEN 1 ELSE 0 END) AS g4,
                       SUM(CASE WHEN grade = 5 THEN 1 ELSE 0 END) AS g5,
                       SUM(CASE WHEN converted IS TRUE THEN 1 ELSE 0 END) AS conversions,
                       COALESCE(SUM(converted_value_ils), 0)::float AS conversion_value_ils
                  FROM joined
                 GROUP BY meta_campaign_id
                 ORDER BY leads_total DESC NULLS LAST
                """,
                {"biz": business_id, "days": days},
            )
            per_campaign_rows = cur.fetchall()

            # Sample lead IDs per campaign — first 5 UNGRADED so the UI knows
            # which to surface next.
            cur.execute(
                """
                SELECT l.id::text AS id, l.meta_campaign_id, l.full_name
                  FROM leads l
                  LEFT JOIN lead_latest_grade g ON g.lead_id = l.id
                 WHERE l.business_id = %(biz)s
                   AND l.archived_at IS NULL
                   AND (
                     l.meta_created_at >= now() - make_interval(days => %(days)s)
                     OR l.meta_created_at IS NULL
                   )
                   AND g.lead_id IS NULL
                 ORDER BY l.meta_created_at DESC
                """,
                {"biz": business_id, "days": days},
            )
            ungraded_rows = cur.fetchall()

            return per_campaign_rows, ungraded_rows

    per_campaign_rows, ungraded_rows = with_db_retry(_fetch)

    # Map campaign_id → first 5 ungraded sample IDs.
    sample_by_campaign: dict[str | None, list[dict]] = {}
    for r in ungraded_rows:
        cid = r.get("meta_campaign_id")
        if cid not in sample_by_campaign:
            sample_by_campaign[cid] = []
        if len(sample_by_campaign[cid]) < 5:
            sample_by_campaign[cid].append(
                {"id": r["id"], "full_name": r.get("full_name")}
            )

    campaigns: list[dict[str, Any]] = []
    overall_total = 0
    overall_graded = 0
    overall_grade_sum = 0.0
    overall_conv = 0
    overall_conv_value = 0.0
    overall_dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}

    for r in per_campaign_rows:
        leads_total = int(r.get("leads_total") or 0)
        leads_graded = int(r.get("leads_graded") or 0)
        avg = r.get("avg_grade")
        dist = {
            1: int(r.get("g1") or 0),
            2: int(r.get("g2") or 0),
            3: int(r.get("g3") or 0),
            4: int(r.get("g4") or 0),
            5: int(r.get("g5") or 0),
        }
        conv = int(r.get("conversions") or 0)
        conv_val = float(r.get("conversion_value_ils") or 0)

        campaigns.append(
            {
                "campaign_id": r.get("meta_campaign_id"),
                "leads_total": leads_total,
                "leads_graded": leads_graded,
                "leads_ungraded": leads_total - leads_graded,
                "avg_grade": avg,
                "grade_distribution": dist,
                "conversions": conv,
                "conversion_value_ils": conv_val,
                "quality_band": _band(leads_total, avg),
                "sample_lead_ids": sample_by_campaign.get(
                    r.get("meta_campaign_id"), []
                ),
            }
        )

        overall_total += leads_total
        overall_graded += leads_graded
        if avg is not None:
            overall_grade_sum += avg * leads_graded
        overall_conv += conv
        overall_conv_value += conv_val
        for k, v in dist.items():
            overall_dist[k] += v

    overall_avg = (
        overall_grade_sum / overall_graded if overall_graded > 0 else None
    )

    return {
        "business_id": business_id,
        "window_days": days,
        "campaigns": campaigns,
        "overall": {
            "leads_total": overall_total,
            "leads_graded": overall_graded,
            "leads_ungraded": overall_total - overall_graded,
            "avg_grade": overall_avg,
            "grade_distribution": overall_dist,
            "conversions": overall_conv,
            "conversion_value_ils": overall_conv_value,
            "quality_band": _band(overall_total, overall_avg),
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Per-campaign lead quality summary (Phase 2)."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=14,
        help="Rolling window. §39 guardrail reads `days=14` to gate winners.",
    )
    args = p.parse_args()

    try:
        emit_success(_summarize(args.business_id, args.days))
    except Exception as e:
        emit_runtime_error(f"summary failed: {e}", e)


if __name__ == "__main__":
    main()
