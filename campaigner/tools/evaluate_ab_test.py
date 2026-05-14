"""
tools/evaluate_ab_test.py — compute the winner of a running A/B test.

Block 11 (2026-05-13). Reads the test's variants from `ab_test_creatives`,
fetches per-creative ad-level insights from Meta (current vs prior window
where relevant), computes the `winner_metric` per variant, picks the winner.

Output shape matches the `decision_snapshot` that `ab_test_decide` writes
into `ab_tests.decision_snapshot`. The agent passes this verbatim into the
proposal payload.

Significance levels:
  - `95pct`        — winner exceeds runner-up by ≥ 20% AND each variant has
                     ≥ 1,000 impressions (sample size proxy).
  - `directional`  — winner exceeds runner-up by ≥ 10% OR sample sizes are
                     between 100 and 1,000 impressions.
  - `insufficient` — fewer than 100 impressions per variant or no winner
                     by ≥ 10% margin.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Same conversion-action taxonomy used by check_creative_fatigue +
# list_active_creatives. Keep in sync intentionally — different tools, same
# Meta conversion mapping.
CONVERSION_TYPES = {
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.purchase",
    "omni_purchase",
    "lead",
    "leadgen.other",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.lead_grouped",
    "onsite_conversion.messaging_conversation_started_7d",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
    "subscribe",
    "start_trial",
    "submit_application",
}

VIDEO_VIEW_3S_ACTIONS = {
    "video_view",
    "video_p25_watched_actions",  # fallback; the 3s metric prefers video_view
}


def _safe_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _sum_action(actions: list | None, allowed: set) -> float:
    if not actions:
        return 0.0
    total = 0.0
    for a in actions:
        if a.get("action_type") in allowed:
            try:
                total += float(a.get("value", 0))
            except (TypeError, ValueError):
                continue
    return total


def _compute_metric(metric: str, m: dict) -> float | None:
    """Compute one variant's metric value. Returns None when insufficient."""
    imp = m.get("impressions", 0)
    if imp <= 0:
        return None
    if metric == "hook_rate":
        # video_view ÷ impressions. If no video views (= still photo or no
        # video activity in window) we return None — hook_rate is only
        # meaningful on video creatives.
        v = m.get("video_3s", 0)
        if v <= 0:
            return None
        return v / imp
    if metric == "ctr":
        return m.get("clicks", 0) / imp
    if metric == "cpa":
        conv = m.get("conversions", 0)
        if conv <= 0:
            return None
        return m.get("spend", 0) / conv
    if metric == "cpl":
        # Same denominator as cpa for our purposes — Meta differentiates by
        # the conversion type taxonomy, not the metric formula.
        conv = m.get("conversions", 0)
        if conv <= 0:
            return None
        return m.get("spend", 0) / conv
    if metric == "conversions":
        return m.get("conversions", 0)
    raise ValueError(f"unknown winner_metric: {metric}")


def _classify_confidence(
    winner_val: float,
    runner_up_val: float,
    per_variant_impressions: list[int],
    metric: str,
) -> tuple[str, float]:
    """Return (confidence_label, margin_pct)."""
    if winner_val == 0 or runner_up_val == 0:
        return ("insufficient", 0.0)

    # For "lower is better" metrics (cpa, cpl), the winner is the smaller
    # value — compute margin relative to runner_up.
    lower_better = metric in ("cpa", "cpl")
    if lower_better:
        margin = (runner_up_val - winner_val) / runner_up_val
    else:
        margin = (winner_val - runner_up_val) / runner_up_val
    margin_pct = round(margin * 100, 2)

    min_imp = min(per_variant_impressions) if per_variant_impressions else 0

    if margin >= 0.20 and min_imp >= 1000:
        return ("95pct", margin_pct)
    if margin >= 0.10 and min_imp >= 100:
        return ("directional", margin_pct)
    return ("insufficient", margin_pct)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Evaluate a running A/B test — compute per-variant metrics and pick the winner."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--ab-test-id", required=True)
    args = p.parse_args()

    try:
        cfg = Config.load()
        cfg.require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        test_row = with_db_retry(
            lambda: fetch_one(
                """
                SELECT id::text, business_id::text, test_name, winner_metric,
                       started_at, planned_end_at, status
                  FROM ab_tests
                 WHERE id = %s AND business_id = %s
                """,
                (args.ab_test_id, args.business_id),
            )
        )
    except Exception as e:
        emit_runtime_error(f"ab_tests fetch failed: {e}", exc=e)
        return

    if not test_row:
        emit_validation_error(
            f"ab_test {args.ab_test_id} not found for business {args.business_id}"
        )
        return

    if test_row["status"] != "running":
        emit_validation_error(
            f"ab_test status='{test_row['status']}' — can only evaluate running tests"
        )
        return

    try:
        variant_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT creative_id, variant_label,
                       creative_gallery_id::text AS creative_gallery_id
                  FROM ab_test_creatives
                 WHERE test_id = %s
                 ORDER BY variant_label
                """,
                (args.ab_test_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"variants fetch failed: {e}", exc=e)
        return

    if not variant_rows:
        emit_runtime_error(
            f"ab_test {args.ab_test_id} has no variants — should be impossible "
            f"if propose+execute went through guardrails"
        )
        return

    # Window: started_at → min(now, planned_end_at)
    started_at = test_row["started_at"]
    end_at = test_row["planned_end_at"]
    now = datetime.now(UTC)
    window_end = end_at if now > end_at else now
    days = max(
        1,
        (window_end - started_at).days + (1 if (window_end - started_at).seconds else 0),
    )

    # Pull ad-level insights from Meta for the window. Meta rejects
    # `creative_id` as an insights field (#100) — fetch separately and join
    # locally via ad_id (same pattern as list_active_creatives.py).
    try:
        cfg.require_meta()
        from campaigner.lib.meta_client import MetaClient

        client = MetaClient(cfg)
        insight_rows = client.fetch_insights(
            level="ad",
            date_preset=f"last_{min(days, 30)}d",
            fields=[
                "ad_id",
                "impressions",
                "clicks",
                "spend",
                "actions",
            ],
        )
        ad_ids = [str(r.get("ad_id")) for r in insight_rows if r.get("ad_id")]
        ad_to_creative = client.get_ad_creative_map(ad_ids)
    except ConfigError as e:
        emit_runtime_error(f"meta credentials missing: {e}", exc=e)
        return
    except Exception as e:
        emit_runtime_error(f"meta insights fetch failed: {e}", exc=e)
        return

    perf_by_creative: dict[str, dict] = {}
    for r in insight_rows:
        ad_id = r.get("ad_id")
        cid = ad_to_creative.get(str(ad_id)) if ad_id else None
        if not cid:
            continue
        perf_by_creative[str(cid)] = {
            "impressions": _safe_float(r.get("impressions")),
            "clicks": _safe_float(r.get("clicks")),
            "spend": _safe_float(r.get("spend")),
            "conversions": _sum_action(r.get("actions"), CONVERSION_TYPES),
            "video_3s": _sum_action(r.get("actions"), VIDEO_VIEW_3S_ACTIONS),
        }

    metric = test_row["winner_metric"]
    creatives_out: list[dict] = []
    metric_values: list[tuple[str, str, float, int]] = []  # (variant, cid, val, imp)
    for v in variant_rows:
        cid = str(v["creative_id"])
        perf = perf_by_creative.get(cid, {})
        metric_val = _compute_metric(metric, perf) if perf else None
        creatives_out.append(
            {
                "variant_label": v["variant_label"],
                "creative_id": cid,
                "creative_gallery_id": v.get("creative_gallery_id"),
                "impressions": int(perf.get("impressions", 0)),
                "clicks": int(perf.get("clicks", 0)),
                "spend": round(perf.get("spend", 0), 2),
                "conversions": round(perf.get("conversions", 0), 2),
                "video_3s_views": int(perf.get("video_3s", 0)),
                "metric_value": (
                    None if metric_val is None else round(metric_val, 4)
                ),
            }
        )
        if metric_val is not None:
            metric_values.append(
                (v["variant_label"], cid, metric_val, int(perf.get("impressions", 0)))
            )

    # Decide.
    winner_block: dict | None = None
    confidence = "insufficient"
    if len(metric_values) >= 2:
        lower_better = metric in ("cpa", "cpl")
        # Sort: ascending for lower-is-better, descending otherwise.
        metric_values.sort(key=lambda t: (1 if lower_better else -1) * t[2])
        top_label, top_cid, top_val, top_imp = metric_values[0]
        _, _, runner_val, _ = metric_values[1]
        per_variant_imp = [t[3] for t in metric_values]
        confidence, margin_pct = _classify_confidence(
            top_val, runner_val, per_variant_imp, metric
        )
        winner_block = {
            "variant_label": top_label,
            "creative_id": top_cid,
            "metric_value": round(top_val, 4),
            "vs_runner_up_pct": margin_pct,
        }

    snapshot = {
        "creatives": creatives_out,
        "winner": winner_block,
        "confidence": confidence,
        "winner_metric": metric,
        "window_days": days,
        "evaluated_at": now.isoformat(),
        "test_name": test_row["test_name"],
        "ready_to_decide": now >= end_at,
    }
    emit_success(snapshot)


if __name__ == "__main__":
    main()
