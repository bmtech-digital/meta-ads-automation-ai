"""
tools/compute_quality_adjusted_kpi.py — raw CPL × quality grades → adjusted CPL.

Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§5). The 16.4 lesson made flesh: cheap raw CPL means nothing if the leads
don't convert. This tool produces the number Gate 2 should look at instead.

Inputs (CLI):
  --business-id   required
  --campaign-id   Meta campaign id; pulls grades + lead counts for THIS campaign only
  --spend-ils     spend over the window (caller already has this from fetch_insights)
  --window-days   default 14 (matches §39 guardrail window)

Math:
  Per-grade weight (what a single lead is *worth*, in "perfect lead" units):
    1 → 0.00   (spam — costs as much as not landing the lead at all)
    2 → 0.25   (low — burns operator time)
    3 → 0.50   (neutral — needs nurturing)
    4 → 1.00   (good — the kind we'd budget for)
    5 → 1.50   (excellent — converts well above average)
    ungraded → 0.50  (default-neutral until graded)

  effective_leads = Σ weight(grade) for graded + 0.5 × ungraded_count
  raw_cpl                = spend / leads_total                  (Meta's number)
  quality_adjusted_cpl   = spend / effective_leads              (the honest number)
  quality_multiplier     = quality_adjusted_cpl / raw_cpl       (1.0=neutral, >1 means
                                                                 "you're paying more per
                                                                 unit-value than CPL suggests")

If `effective_leads == 0` → returns `quality_adjusted_cpl: null` and
`status: "all_spam"` — guardrail §39 reads that as a hard block on scale_up.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

GRADE_WEIGHTS: dict[int, float] = {
    1: 0.00,
    2: 0.25,
    3: 0.50,
    4: 1.00,
    5: 1.50,
}
UNGRADED_WEIGHT: float = 0.50


def _resolve_target(
    business_id: str, objective: str | None
) -> tuple[float | None, str, dict | None]:
    """Resolve the right KPI target for this objective.

    Lookup order (mastery plan §8):
      1. business.kpis_per_objective[<objective>].target
      2. business.target_cpl_ils / target_cpa_ils / target_roas matching primary_kpi
      3. None (caller falls back to vertical band)

    Returns (target_value, source, raw_dict).
    """
    from campaigner.lib.db import fetch_one as _fetch_one

    biz = _fetch_one(
        "SELECT primary_kpi, target_cpa_ils, target_cpl_ils, target_roas, "
        "kpis_per_objective FROM businesses WHERE id = %s",
        (business_id,),
    )
    if not biz:
        return None, "business_not_found", None
    kpo = biz.get("kpis_per_objective") or {}
    if objective and isinstance(kpo, dict) and objective in kpo:
        entry = kpo[objective] or {}
        if entry.get("target") is not None:
            return float(entry["target"]), "per_objective", entry
    # Business-level fallback by primary_kpi.
    primary = biz.get("primary_kpi")
    if primary == "cpl" and biz.get("target_cpl_ils") is not None:
        return float(biz["target_cpl_ils"]), "business_target_cpl", None
    if primary == "cpa" and biz.get("target_cpa_ils") is not None:
        return float(biz["target_cpa_ils"]), "business_target_cpa", None
    if primary == "roas" and biz.get("target_roas") is not None:
        return float(biz["target_roas"]), "business_target_roas", None
    return None, "no_target", None


def _compute(
    business_id: str,
    campaign_id: str | None,
    spend_ils: float,
    window_days: int,
    objective: str | None = None,
) -> dict:
    def _fetch():
        with get_connection() as conn, conn.cursor() as cur:
            params: dict = {"biz": business_id, "days": window_days}
            campaign_clause = ""
            if campaign_id:
                campaign_clause = " AND l.meta_campaign_id = %(cid)s"
                params["cid"] = campaign_id
            cur.execute(
                f"""
                SELECT g.grade, COUNT(*) AS n,
                       SUM(CASE WHEN g.converted IS TRUE THEN 1 ELSE 0 END) AS conv,
                       COALESCE(SUM(g.converted_value_ils), 0) AS conv_val
                  FROM leads l
                  LEFT JOIN lead_latest_grade g ON g.lead_id = l.id
                 WHERE l.business_id = %(biz)s
                   AND l.archived_at IS NULL
                   AND (
                     l.meta_created_at >= now() - make_interval(days => %(days)s)
                     OR l.meta_created_at IS NULL
                   )
                   {campaign_clause}
                 GROUP BY g.grade
                """,
                params,
            )
            return cur.fetchall()

    rows = with_db_retry(_fetch)

    leads_total = 0
    graded_count = 0
    ungraded_count = 0
    dist: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    conversions = 0
    conv_value = 0.0
    for r in rows:
        n = int(r.get("n") or 0)
        leads_total += n
        g = r.get("grade")
        if g is None:
            ungraded_count += n
        else:
            gi = int(g)
            dist[gi] = dist.get(gi, 0) + n
            graded_count += n
        conversions += int(r.get("conv") or 0)
        conv_value += float(r.get("conv_val") or 0)

    effective_leads = (
        sum(dist.get(g, 0) * GRADE_WEIGHTS[g] for g in GRADE_WEIGHTS)
        + ungraded_count * UNGRADED_WEIGHT
    )
    raw_cpl = (spend_ils / leads_total) if leads_total > 0 else None
    quality_adjusted_cpl = (spend_ils / effective_leads) if effective_leads > 0 else None
    multiplier = (quality_adjusted_cpl / raw_cpl) if (raw_cpl and quality_adjusted_cpl) else None

    if leads_total == 0:
        status = "no_leads"
    elif effective_leads == 0:
        status = "all_spam"
    elif graded_count < 5:
        status = "insufficient_grades"
    elif effective_leads / leads_total >= 0.7:
        status = "high_quality"
    elif effective_leads / leads_total >= 0.4:
        status = "mixed_quality"
    else:
        status = "low_quality"

    # Phase 5: target lookup + vs-target verdict.
    target_value, target_source, target_entry = _resolve_target(business_id, objective)
    target_block: dict = {
        "value": target_value,
        "source": target_source,
        "objective": objective,
        "entry": target_entry,
    }
    vs_target: dict | None = None
    if target_value is not None and quality_adjusted_cpl is not None and target_value > 0:
        ratio = quality_adjusted_cpl / target_value
        if ratio <= 1.0:
            verdict = "under_target"
        elif ratio <= 1.2:
            verdict = "at_target"
        elif ratio <= 1.5:
            verdict = "over_target"
        else:
            verdict = "far_over_target"
        vs_target = {
            "ratio_adjusted_to_target": round(ratio, 2),
            "verdict": verdict,
        }

    return {
        "business_id": business_id,
        "campaign_id": campaign_id,
        "window_days": window_days,
        "spend_ils": spend_ils,
        "leads_total": leads_total,
        "leads_graded": graded_count,
        "leads_ungraded": ungraded_count,
        "grade_distribution": dist,
        "effective_leads": round(effective_leads, 2),
        "raw_cpl_ils": (round(raw_cpl, 2) if raw_cpl is not None else None),
        "quality_adjusted_cpl_ils": (
            round(quality_adjusted_cpl, 2) if quality_adjusted_cpl is not None else None
        ),
        "quality_multiplier": (round(multiplier, 2) if multiplier is not None else None),
        "conversions": conversions,
        "conversion_value_ils": round(conv_value, 2),
        "weights": {"grades": GRADE_WEIGHTS, "ungraded": UNGRADED_WEIGHT},
        "status": status,
        "target": target_block,
        "vs_target": vs_target,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Quality-adjusted CPL using operator lead grades.")
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--campaign-id",
        default=None,
        help="Meta campaign id; omit to compute across all campaigns.",
    )
    p.add_argument(
        "--spend-ils",
        type=float,
        required=True,
        help="Window spend in ILS (caller already has it from fetch_insights).",
    )
    p.add_argument(
        "--window-days",
        type=int,
        default=14,
        help="Lead window. Matches §39 guardrail.",
    )
    p.add_argument(
        "--objective",
        default=None,
        help="Meta campaign objective (e.g. OUTCOME_LEADS). When supplied, "
        "the per-objective KPI target is looked up from "
        "businesses.kpis_per_objective and the output includes a vs_target verdict.",
    )
    args = p.parse_args()

    if args.spend_ils < 0:
        emit_validation_error(f"--spend-ils must be >= 0, got {args.spend_ils}")
        return

    try:
        emit_success(
            _compute(
                args.business_id,
                args.campaign_id,
                args.spend_ils,
                args.window_days,
                args.objective,
            )
        )
    except Exception as e:
        emit_runtime_error(f"compute failed: {e}", e)


if __name__ == "__main__":
    main()
