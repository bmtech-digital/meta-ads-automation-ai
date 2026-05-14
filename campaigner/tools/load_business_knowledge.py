"""
tools/load_business_knowledge.py — read business + knowledge row as JSON.

Used by observe-propose Step 1 so Claude has the vertical, primary_kpi,
questionnaire answers, brand voice, competitors — everything that shapes
diagnosis and rationale writing.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Load business + business_knowledge for Claude context."
    )
    p.add_argument("--business-id", required=True)
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        business = with_db_retry(
            lambda: fetch_one(
                """
            SELECT id, name, timezone, meta_ad_account_id, meta_page_id,
                   meta_auth_mode, gcp_project_id,
                   monthly_budget_ils, daily_budget_ils, primary_kpi,
                   target_cpa_ils, target_cpl_ils, target_roas,
                   kpis_per_objective,
                   monthly_brief,
                   active, created_at
            FROM businesses
            WHERE id = %s
            """,
                (args.business_id,),
            )
        )
        if business is None:
            emit_validation_error(f"business not found: {args.business_id}")
            return
        knowledge = with_db_retry(
            lambda: fetch_one(
                """
            SELECT vertical, website_url, service_regions,
                   customer_age_min, customer_age_max,
                   products, delivery_time_days,
                   strong_seasons, weak_seasons,
                   questionnaire_answers, brand_voice, competitors,
                   last_refreshed_at
            FROM business_knowledge
            WHERE business_id = %s
            """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business knowledge load failed: {e}", exc=e)
        return

    # Convenience: select the KPI target that matches business.primary_kpi.
    # Saves every caller from re-implementing the branching. None = not set
    # for the active KPI; per migration 019 the agent should emit an alert
    # in that case rather than fall back to baseline medians.
    primary_kpi = business.get("primary_kpi") if business else None
    target_value = None
    target_field = None
    if primary_kpi == "cpa":
        target_field = "target_cpa_ils"
        target_value = business.get("target_cpa_ils")
    elif primary_kpi == "cpl":
        target_field = "target_cpl_ils"
        target_value = business.get("target_cpl_ils")
    elif primary_kpi == "roas":
        target_field = "target_roas"
        target_value = business.get("target_roas")
    # cpm/cpi deferred per migration 019 — leave target_value None.

    # Monthly brief — flag staleness so the agent knows whether to trust it.
    # `month` is YYYY-MM in Israel time as stamped by the web layer on save.
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    brief = business.get("monthly_brief") if business else None
    now_il = _dt.now(ZoneInfo("Asia/Jerusalem"))
    current_month = now_il.strftime("%Y-%m")
    brief_summary: dict = {
        "is_set": brief is not None and bool(brief),
        "is_current_month": False,
        "month_in_brief": None,
        "current_month": current_month,
    }
    if isinstance(brief, dict) and brief:
        brief_month = brief.get("month")
        brief_summary["month_in_brief"] = brief_month
        brief_summary["is_current_month"] = brief_month == current_month
        if brief_month and brief_month != current_month:
            brief_summary["stale_reason"] = (
                f"brief is for {brief_month} but current month is {current_month}"
            )

    # Phase 5 (mastery plan §8) — per-objective KPI map. Surfaced as a
    # convenience `kpis_per_objective` block so the agent can look up
    # `kpis_per_objective[OBJECTIVE].target` directly for any campaign's
    # objective without re-implementing the lookup. Empty dict if not set.
    kpis_per_obj = (business.get("kpis_per_objective") if business else None) or {}

    emit_success(
        {
            "business_id": args.business_id,
            "business": business,
            "knowledge": knowledge,
            "knowledge_present": knowledge is not None,
            "kpi_target": {
                "primary_kpi": primary_kpi,
                "target_field": target_field,
                "target_value": float(target_value) if target_value is not None else None,
                "is_set": target_value is not None,
            },
            "kpis_per_objective": kpis_per_obj,
            "kpis_per_objective_count": len(kpis_per_obj) if isinstance(kpis_per_obj, dict) else 0,
            "monthly_brief_summary": brief_summary,
        }
    )


if __name__ == "__main__":
    main()
