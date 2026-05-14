"""
tools/estimate_cpl.py — produce a CPL/CPA estimate WITHOUT a WebSearch.

Used by Flow A `set_kpi_target` and any §T-2 reality-check that needs a
benchmark. Reads business + business_knowledge, applies the modifier stack
from `lib/cpl_infrastructure`, and emits a JSON payload shaped to drop
directly into `propose_task --research <json>` so the proposal passes
guardrail §26 set_kpi_target_requires_research without a live web search.

Token-saving lever — see `campaigner/prompts/cpl-infrastructure.md` §10
for the explicit "live-WebSearch escape hatch" cases when the agent should
NOT trust this output and run a real search instead.

Contract: §11.6 (JSON stdout, exit 0/1/2).

Usage:
  python -m campaigner.tools.estimate_cpl --business-id <uuid>
  python -m campaigner.tools.estimate_cpl --business-id <uuid> \
      --stage warm_visit --offer demo_request --channel click_to_whatsapp
  python -m campaigner.tools.estimate_cpl --business-id <uuid> \
      --month nov --security-event
  python -m campaigner.tools.estimate_cpl --business-id <uuid> \
      --sub-vertical saas_marketing_tech   # override matched sub-vertical
"""

from __future__ import annotations

import argparse
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.cpl_infrastructure import (
    SUBVERTICALS,
    Channel,
    EstimateInput,
    FunnelStage,
    GeoTier,
    OfferType,
    SubVertical,
    Vertical,
    estimate_cpl,
    is_generic_campaign_name,
    match_sub_vertical,
    month_of,
    pick_geo_tier,
)
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _enum_choices(enum_cls: type) -> list[str]:
    return [e.value for e in enum_cls]


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Estimate a CPL/CPA without WebSearch by applying the static "
            "cpl-infrastructure modifier stack to business_knowledge."
        )
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--stage",
        choices=_enum_choices(FunnelStage),
        default=FunnelStage.COLD.value,
        help="Funnel stage of the audience being targeted. Default: cold.",
    )
    p.add_argument(
        "--offer",
        choices=_enum_choices(OfferType),
        default=OfferType.CONSULTATION_FREE.value,
        help="Offer type. Default: consultation_free (IL services baseline).",
    )
    p.add_argument(
        "--channel",
        choices=_enum_choices(Channel),
        default=None,
        help=(
            "Ad channel. If unset, defaults to click_to_whatsapp for `leads` "
            "vertical (IL B2C default) and lead_form otherwise."
        ),
    )
    p.add_argument(
        "--month",
        choices=[
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
        ],
        default=None,
        help="Month key for seasonality. Default: current month in Asia/Jerusalem.",
    )
    p.add_argument(
        "--security-event",
        action="store_true",
        help="Apply wartime ×2 multiplier (operator-flagged manually).",
    )
    p.add_argument(
        "--sub-vertical",
        choices=_enum_choices(SubVertical),
        default=None,
        help=(
            "Override the matched sub-vertical. Useful when the operator "
            "knows better than the matcher (rare). Skips match_sub_vertical "
            "and consumes the provided sub-vertical directly."
        ),
    )
    p.add_argument(
        "--campaign-name",
        default=None,
        help=(
            "Per-campaign override: when set, the campaign name is folded "
            "into the matcher haystack with ×3 weight, so a multi-product "
            "business gets the sub-vertical of THIS campaign instead of "
            "the aggregate. The agent should pass `--campaign-name=<Meta "
            "campaign name>` for every per-campaign §T-2 reality-check."
        ),
    )
    p.add_argument(
        "--geo",
        choices=_enum_choices(GeoTier),
        default=None,
        help=(
            "Override the geo tier picked from service_regions. Use sparingly "
            "— the matcher is usually right."
        ),
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        business = with_db_retry(
            lambda: fetch_one(
                "SELECT id, name, primary_kpi FROM businesses WHERE id = %s",
                (args.business_id,),
            )
        )
        if business is None:
            emit_validation_error(f"business not found: {args.business_id}")
            return
        knowledge = with_db_retry(
            lambda: fetch_one(
                """
                SELECT vertical, service_regions, products, questionnaire_answers
                FROM business_knowledge
                WHERE business_id = %s
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business_knowledge load failed: {e}", exc=e)
        return

    if knowledge is None:
        emit_validation_error(
            f"business_knowledge row missing for {args.business_id} — "
            "operator must fill /business-knowledge first"
        )
        return

    vertical_raw = knowledge.get("vertical")
    vertical: Vertical | None = (
        vertical_raw
        if vertical_raw
        in (
            "ecommerce",
            "leads",
            "b2b_saas",
            "awareness",
            "app",
            "other",
        )
        else None
    )

    # ── match sub-vertical ──
    products_blob = _products_to_text(knowledge.get("products"))
    qa = knowledge.get("questionnaire_answers") or {}
    if not isinstance(qa, dict):
        qa = {}
    ideal_customer = qa.get("ideal_customer")
    usp = qa.get("usp")
    main_pain = qa.get("main_pain")

    if args.sub_vertical:
        sub = SubVertical(args.sub_vertical)
        match_meta: dict[str, Any] = {
            "sub": sub.value,
            "matched_terms": [],
            "confidence_of_match": "override",
            "campaign_name": args.campaign_name,
        }
    else:
        match = match_sub_vertical(
            vertical=vertical,
            products_raw=products_blob,
            ideal_customer=ideal_customer,
            usp=usp,
            main_pain=main_pain,
            campaign_name=args.campaign_name,
        )
        sub = match.sub
        match_meta = {
            "sub": sub.value,
            "matched_terms": list(match.matched_terms),
            "confidence_of_match": match.confidence_of_match,
            "campaign_name": args.campaign_name,
        }

    # ── pick geo ──
    if args.geo:
        geo = GeoTier(args.geo)
    else:
        geo = pick_geo_tier(knowledge.get("service_regions"))

    # ── default channel based on parent vertical ──
    if args.channel:
        channel = Channel(args.channel)
    else:
        cell = SUBVERTICALS[sub]
        # For B2C services (leads), CTWA is the IL default. Everything else
        # defaults to lead_form (the global baseline).
        channel = Channel.CLICK_TO_WHATSAPP if cell.parent == "leads" else Channel.LEAD_FORM

    # ── month ──
    if args.month:
        month_key = args.month  # type: ignore[assignment]
    else:
        now_il = datetime.now(ZoneInfo("Asia/Jerusalem"))
        month_key = month_of(now_il.month)

    # ── estimate ──
    estimate = estimate_cpl(
        EstimateInput(
            sub=sub,
            geo=geo,
            stage=FunnelStage(args.stage),
            offer=OfferType(args.offer),
            channel=channel,
            month=month_key,  # type: ignore[arg-type]
            security_event=args.security_event,
        )
    )

    # ── context_used: which business_knowledge fields shaped the estimate ──
    context_used: list[str] = ["vertical"]
    if products_blob:
        context_used.append("products")
    if knowledge.get("service_regions"):
        context_used.append("service_regions")
    if ideal_customer:
        context_used.append("ideal_customer")
    if usp:
        context_used.append("usp")
    if main_pain:
        context_used.append("main_pain")

    # ── decide whether the agent should still WebSearch on top ──
    needs_live_research = (
        estimate.confidence == "low" or match_meta["confidence_of_match"] == "fallback"
    )

    # ── detect generic / uninformative campaign name (F7, 2026-05-13) ──
    # When True, §T-2 in decision-tree.md says the agent should propose an
    # `alert` task asking the operator to rename the campaign. The matcher
    # already returned a fallback-style result for these (no campaign-name
    # term hits), but we surface the diagnostic flag explicitly so the agent
    # doesn't need to re-detect.
    is_generic, generic_reason = is_generic_campaign_name(args.campaign_name)
    needs_rename_alert = (
        args.campaign_name is not None and is_generic and args.campaign_name.strip() != ""
    )

    research_block = estimate.to_research_block(context_used=context_used)

    emit_success(
        {
            "business_id": args.business_id,
            "match": match_meta,
            "inputs": {
                "sub_vertical": sub.value,
                "geo": geo.value,
                "stage": args.stage,
                "offer": args.offer,
                "channel": channel.value,
                "month": month_key,
                "security_event": args.security_event,
            },
            "estimate": {
                "value_ils": estimate.value_ils,
                "band_ils": list(estimate.band_ils),
                "confidence": estimate.confidence,
                "is_cpa": estimate.is_cpa,
                "trace": [
                    {
                        "step": t.step,
                        "multiplier": t.multiplier,
                        "running_value": t.running_value,
                    }
                    for t in estimate.trace
                ],
            },
            # Ready to feed into propose_task --research (satisfies guardrail §26).
            "research_block": research_block,
            "needs_live_research": needs_live_research,
            "context_used": context_used,
            # F7 (2026-05-13) — generic campaign-name diagnostic.
            "campaign_name_diagnostic": {
                "name": args.campaign_name,
                "is_generic": bool(is_generic and args.campaign_name),
                "reason": generic_reason if args.campaign_name else None,
                "agent_action": ("propose_alert_rename_campaign" if needs_rename_alert else None),
            },
        }
    )


def _products_to_text(products: Any) -> str | None:
    """
    Flatten the `products` jsonb (list of {name, description, ...}) into a
    single text blob suitable for match_sub_vertical's haystack.
    """
    if not products:
        return None
    if not isinstance(products, list):
        return None
    parts: list[str] = []
    for item in products:
        if isinstance(item, dict):
            name = item.get("name")
            desc = item.get("description")
            if name:
                parts.append(str(name))
            if desc:
                parts.append(str(desc))
        elif isinstance(item, str):
            parts.append(item)
    return "  ".join(parts) if parts else None


if __name__ == "__main__":
    main()
