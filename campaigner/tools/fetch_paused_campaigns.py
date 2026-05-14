"""
tools/fetch_paused_campaigns.py — list paused campaigns + last-30d performance.

Built 2026-05-13 to support decision-tree §T_PA (Paused Campaign Audit). The
agent reads paused campaigns once per run and classifies each into:

  - `revival_candidate`        — CPL ≤ 1.2× target AND CTR ≥ 1.5% (worth re-visiting)
  - `narrow_audience_revival`  — CPM > 80 IL AND impressions < 5000 (cheap with expand)
  - `archive_candidate`        — neither of the above (leave paused)

Classification thresholds live here (one place) — the decision-tree prompt
references the lanes by name and reads `lane` from this output verbatim.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _classify(cpl_vs_target: float | None, ctr_pct: float | None,
              cpm_ils: float, impressions: int,
              lead_quality_band: str | None = None) -> str:
    """Return the lane name §T_PA expects.

    Phase 6 (mastery plan §9, the 16.4 paradox): if Meta-internal metrics
    looked great but lead quality was poor, the campaign IS NOT a revival
    candidate — it's a `quality_warned` candidate (operator should rework the
    targeting/creative before resuming, not just unpause).
    """
    base_lane = "archive_candidate"
    if cpl_vs_target is not None and ctr_pct is not None:
        if cpl_vs_target <= 1.2 and ctr_pct >= 1.5:
            base_lane = "revival_candidate"
    if base_lane == "archive_candidate" and cpm_ils > 80 and impressions < 5000:
        base_lane = "narrow_audience_revival"

    # Phase 6 downgrade: a revival_candidate with poor lead quality during
    # its active period gets flagged. Resuming as-is reproduces the 16.4
    # failure mode (cheap Meta metrics, garbage leads).
    if base_lane == "revival_candidate" and lead_quality_band in (
        "low_quality",
        "all_spam",
    ):
        return "quality_warned_revival"

    return base_lane


def _lead_quality_for_campaign(
    business_id: str, campaign_id: str
) -> tuple[str | None, int, int, float | None]:
    """Return (band, leads_total, leads_graded, avg_grade) for leads tied
    to this Meta campaign id. Uses the same band logic as §40 / Phase 2.

    Phase 6 cross-reference — returns ('no_leads', 0, 0, None) if no leads
    exist for the campaign, which leaves the base classifier alone.
    """
    from campaigner.lib.db import fetch_one as _f

    row = _f(
        """
        WITH wl AS (
          SELECT l.id
            FROM leads l
           WHERE l.business_id = %s
             AND l.meta_campaign_id = %s
             AND l.archived_at IS NULL
        )
        SELECT
          (SELECT COUNT(*) FROM wl) AS leads_total,
          (SELECT COUNT(*) FROM wl JOIN lead_latest_grade g ON g.lead_id = wl.id) AS leads_graded,
          (SELECT AVG(g.grade)::float FROM wl JOIN lead_latest_grade g ON g.lead_id = wl.id) AS avg_grade,
          (SELECT SUM(CASE g.grade
                         WHEN 1 THEN 0.00
                         WHEN 2 THEN 0.25
                         WHEN 3 THEN 0.50
                         WHEN 4 THEN 1.00
                         WHEN 5 THEN 1.50
                         ELSE 0 END)::float
             FROM wl JOIN lead_latest_grade g ON g.lead_id = wl.id) AS weighted_sum
        """,
        (business_id, campaign_id),
    )
    if not row:
        return "no_leads", 0, 0, None
    leads_total = int(row.get("leads_total") or 0)
    leads_graded = int(row.get("leads_graded") or 0)
    avg = row.get("avg_grade")
    weighted = float(row.get("weighted_sum") or 0)
    effective = weighted + (leads_total - leads_graded) * 0.5
    if leads_total == 0:
        return "no_leads", 0, 0, None
    if effective == 0:
        return "all_spam", leads_total, leads_graded, avg
    if leads_graded < 5:
        return "insufficient_grades", leads_total, leads_graded, avg
    ratio = effective / leads_total
    if ratio >= 0.7:
        return "high_quality", leads_total, leads_graded, avg
    if ratio >= 0.4:
        return "mixed_quality", leads_total, leads_graded, avg
    return "low_quality", leads_total, leads_graded, avg


def _extract_leads(insights_row: dict) -> int:
    """Sum lead actions from a Meta insights row. Meta exposes leads under
    several action_type keys depending on event source — we count them all
    once (lead_grouped is the de-duplicated total when present)."""
    actions = insights_row.get("actions") or []
    if not isinstance(actions, list):
        return 0
    # Prefer lead_grouped (Meta's deduplicated count); fall back to `lead`.
    for key in ("onsite_conversion.lead_grouped", "lead"):
        for a in actions:
            if a.get("action_type") == key:
                try:
                    return int(float(a.get("value") or 0))
                except (TypeError, ValueError):
                    return 0
    return 0


def main() -> None:
    p = argparse.ArgumentParser(
        description="List paused campaigns + 30-day insights — for §T_PA audit.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--max-days-since-paused",
        type=int,
        default=90,
        help="Skip campaigns whose updated_time is older than N days (market moved on). Default 90.",
    )
    args = p.parse_args()

    try:
        config = Config.load().require_db()
        client = MetaClient(config)
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Pull target_cpl_ils from businesses to compute cpl_vs_target.
    try:
        row = with_db_retry(
            lambda: fetch_one(
                "SELECT target_cpl_ils FROM businesses WHERE id = %s",
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"businesses lookup failed: {e}", exc=e)
        return
    target_cpl = row["target_cpl_ils"] if row else None
    target_cpl_float = float(target_cpl) if target_cpl else None

    # List paused campaigns from Meta.
    try:
        campaigns = client.list_campaigns(status_filter=["PAUSED"])
    except Exception as e:
        emit_runtime_error(f"Meta list_campaigns failed: {e}", exc=e)
        return

    # For each, pull last-30d insights (these are pre-pause numbers since the
    # campaign hasn't run since updated_time). Skip campaigns paused > N days
    # ago — the data is too stale.
    now = datetime.now(UTC)
    audited: list[dict] = []
    skipped_stale = 0
    for c in campaigns:
        updated = c.get("updated_time")
        days_since_paused: float | None = None
        if updated:
            try:
                dt = datetime.fromisoformat(updated)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                days_since_paused = round((now - dt).total_seconds() / 86400, 1)
            except (TypeError, ValueError):
                days_since_paused = None

        if days_since_paused is not None and days_since_paused > args.max_days_since_paused:
            skipped_stale += 1
            continue

        # Insights for the campaign — fetch 30 days ending at updated_time
        # (approximate; if updated_time was recent the window covers active period).
        try:
            insights = client.fetch_insights(
                level="campaign",
                date_preset="last_30d",
                filtering=[{"field": "campaign.id", "operator": "EQUAL", "value": c["id"]}],
            )
        except Exception as e:
            audited.append({
                "campaign_id": c["id"],
                "campaign_name": c.get("name"),
                "days_since_paused": days_since_paused,
                "lane": "archive_candidate",
                "error": f"insights fetch failed: {e}",
            })
            continue

        row = insights[0] if insights else {}
        spend = float(row.get("spend") or 0)
        impressions = int(row.get("impressions") or 0)
        clicks = int(row.get("clicks") or 0)
        cpm = float(row.get("cpm") or 0)
        ctr_pct = float(row.get("ctr") or 0)
        leads = _extract_leads(row) if row else 0
        cpl_actual: float | None = (spend / leads) if leads > 0 else None
        cpl_vs_target: float | None = (
            (cpl_actual / target_cpl_float)
            if (cpl_actual is not None and target_cpl_float)
            else None
        )

        # Phase 6 — pull lead quality for this campaign so §T_PA can downgrade
        # revival_candidate → quality_warned_revival when the leads were bad.
        try:
            lq_band, lq_total, lq_graded, lq_avg = _lead_quality_for_campaign(
                args.business_id, c["id"]
            )
        except Exception:
            lq_band, lq_total, lq_graded, lq_avg = "no_leads", 0, 0, None

        lane = _classify(cpl_vs_target, ctr_pct, cpm, impressions, lq_band)

        audited.append({
            "campaign_id": c["id"],
            "campaign_name": c.get("name"),
            "objective": c.get("objective"),
            "days_since_paused": days_since_paused,
            "spend_ils": round(spend, 2),
            "impressions": impressions,
            "clicks": clicks,
            "ctr_pct": round(ctr_pct, 2),
            "cpm_ils": round(cpm, 2),
            "leads": leads,
            "cpl_actual_ils": round(cpl_actual, 2) if cpl_actual is not None else None,
            "cpl_vs_target": round(cpl_vs_target, 2) if cpl_vs_target is not None else None,
            "lead_quality_band": lq_band,
            "lead_quality_total": lq_total,
            "lead_quality_graded": lq_graded,
            "lead_quality_avg": (round(lq_avg, 2) if lq_avg is not None else None),
            "lane": lane,
        })

    revival_count = sum(1 for r in audited if r["lane"] == "revival_candidate")
    narrow_count = sum(1 for r in audited if r["lane"] == "narrow_audience_revival")
    archive_count = sum(1 for r in audited if r["lane"] == "archive_candidate")
    quality_warned_count = sum(
        1 for r in audited if r["lane"] == "quality_warned_revival"
    )

    emit_success({
        "business_id": args.business_id,
        "target_cpl_ils": target_cpl_float,
        "paused_campaign_count": len(audited),
        "skipped_stale_count": skipped_stale,
        "revival_candidate_count": revival_count,
        "narrow_audience_revival_count": narrow_count,
        "archive_candidate_count": archive_count,
        "quality_warned_revival_count": quality_warned_count,
        "campaigns": audited,
    })


if __name__ == "__main__":
    main()
