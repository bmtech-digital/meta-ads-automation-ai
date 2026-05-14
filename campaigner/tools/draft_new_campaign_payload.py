"""
tools/draft_new_campaign_payload.py — auto-fill the new_campaign payload from
business_knowledge so the agent doesn't hand-roll 20 fields per campaign.

Built 2026-05-13 PM as the operator's "consultant fills the form" capability:
the agent provides high-level intent (objective + hypothesis + budget +
copy/asset), and this tool composes the FULL payload that satisfies guardrail
§38 `new_campaign_payload_completeness` — pulling page_id, pixel_id, geo,
service_tag context, brand defaults, and tracking template from
`businesses` + `business_knowledge`.

Outputs a payload ready to drop into:
    propose_task --task-type new_campaign --payload "$(this_tool_output.payload)"

This is the practical step toward "the agent does the work the marketing
agency would do": the operator approves a complete, internally-consistent
campaign spec in one click instead of correcting 12 missing fields.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Map agent's high-level objective → Meta optimization_goal default.
# Agent can override with --optimization-goal; otherwise this is the right
# default per Meta's API documentation + 2026 best-practice.
_DEFAULT_OPT_GOAL = {
    "OUTCOME_LEADS": "LEAD_GENERATION",
    "OUTCOME_SALES": "OFFSITE_CONVERSIONS",
    "OUTCOME_ENGAGEMENT": "CONVERSATIONS",
    "OUTCOME_TRAFFIC": "LANDING_PAGE_VIEWS",
    "OUTCOME_AWARENESS": "REACH",
    "OUTCOME_APP_PROMOTION": "APP_INSTALLS",
}

# Which objectives need pixel_id vs page_id in promoted_object (per §38).
_OBJECTIVES_NEEDING_PIXEL = ("OUTCOME_SALES",)
_OBJECTIVES_NEEDING_PAGE = ("OUTCOME_LEADS", "OUTCOME_ENGAGEMENT")


def _meta_country_codes(service_regions: list[str] | None) -> list[str]:
    """Translate Hebrew/English region names to ISO-3166. Legacy fallback used
    only when business_knowledge.geo_targeting is null. For Aiweon's MVP scope
    (Israel-only), the mapping is small."""
    if not service_regions:
        return ["IL"]
    out: list[str] = []
    for r in service_regions:
        rs = r.strip().lower()
        if rs in ("ישראל", "israel", "il"):
            out.append("IL")
        elif rs in ("ארצות הברית", "united states", "us", "usa"):
            out.append("US")
        elif rs in ("בריטניה", "united kingdom", "uk", "gb"):
            out.append("GB")
        else:
            if "IL" not in out:
                out.append("IL")
    return out or ["IL"]


def _build_geo_locations(
    geo_block: dict | None,
    fallback_countries: list[str],
) -> dict:
    """Translate one half (include or exclude) of business_knowledge.geo_targeting
    into Meta's `geo_locations` / `excluded_geo_locations` shape.

    Per migration 025, our jsonb shape is:
        {countries, regions, cities, radius_centers, zips}
    Meta expects:
        countries: list[str]
        regions:   list[{key, name}]
        cities:    list[{key, name, ?radius, ?distance_unit}]
        zips:      list[{key, name}]
        custom_locations: list[{latitude, longitude, radius, distance_unit, name}]
                                    -- this is where radius_centers lands.

    A city without a `radius` falls back to Meta's ~17km default — which is
    Roi's intended "טרגט את ת"א" semantics (city without radius == city + nearby).
    """
    if not isinstance(geo_block, dict) or not geo_block:
        return {"countries": fallback_countries}

    out: dict = {}
    countries = geo_block.get("countries") or []
    if isinstance(countries, list) and countries:
        out["countries"] = [str(c) for c in countries if c]

    regions = geo_block.get("regions") or []
    if isinstance(regions, list) and regions:
        out["regions"] = [
            {"key": str(r["key"]), "name": str(r.get("name") or "")}
            for r in regions
            if isinstance(r, dict) and r.get("key")
        ]

    cities = geo_block.get("cities") or []
    if isinstance(cities, list) and cities:
        out["cities"] = [
            {"key": str(c["key"]), "name": str(c.get("name") or "")}
            for c in cities
            if isinstance(c, dict) and c.get("key")
        ]

    zips = geo_block.get("zips") or []
    if isinstance(zips, list) and zips:
        out["zips"] = [
            {"key": str(z["key"]), "name": str(z.get("name") or "")}
            for z in zips
            if isinstance(z, dict) and z.get("key")
        ]

    centers = geo_block.get("radius_centers") or []
    if isinstance(centers, list) and centers:
        out["custom_locations"] = [
            {
                "latitude": float(c["latitude"]),
                "longitude": float(c["longitude"]),
                "radius": int(c["radius_km"]),
                "distance_unit": "kilometer",
                "name": str(c.get("name") or "custom"),
            }
            for c in centers
            if isinstance(c, dict)
            and c.get("latitude") is not None
            and c.get("longitude") is not None
            and c.get("radius_km") is not None
        ]

    # Meta requires at least one of countries / regions / cities / zips /
    # custom_locations. If the operator built an exclude-only block (no
    # positive geo at all), fall back to country-level so the spec is valid.
    if not out:
        return {"countries": fallback_countries}
    return out


def _build_geo_targeting(
    geo_targeting: dict | str | None,
    service_regions: list[str] | None,
) -> tuple[dict, dict | None]:
    """Returns (geo_locations, excluded_geo_locations) for the Meta targeting
    spec. Reads business_knowledge.geo_targeting first (migration 025); falls
    back to the legacy service_regions list when the new field is null.
    """
    fallback = _meta_country_codes(service_regions)
    if isinstance(geo_targeting, str):
        try:
            geo_targeting = json.loads(geo_targeting)
        except (TypeError, ValueError):
            geo_targeting = None
    if not isinstance(geo_targeting, dict):
        return {"countries": fallback}, None

    include = _build_geo_locations(geo_targeting.get("include"), fallback)
    excluded_raw = geo_targeting.get("exclude")
    if isinstance(excluded_raw, dict):
        excluded = _build_geo_locations(excluded_raw, [])
        # Strip the empty-fallback {countries: []} we'd get from an empty exclude block.
        if excluded == {"countries": []} or not excluded.get("countries", True):
            excluded.pop("countries", None)
        if not excluded:
            excluded_out: dict | None = None
        else:
            excluded_out = excluded
    else:
        excluded_out = None
    return include, excluded_out


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compose a complete `new_campaign` payload by reading "
        "business_knowledge + caller-supplied intent. Output passes guardrail §38.",
    )
    p.add_argument("--business-id", required=True)

    # ─── high-level intent (the agent provides these) ─────────────────────
    p.add_argument("--campaign-name", required=True, help="Hebrew descriptive name.")
    p.add_argument(
        "--objective",
        required=True,
        choices=list(_DEFAULT_OPT_GOAL.keys()),
    )
    p.add_argument("--daily-budget-ils", type=float, required=True)
    p.add_argument("--hypothesis", default=None, help="One-line Hebrew, why this will work.")
    p.add_argument(
        "--service-tag",
        default=None,
        help="business_knowledge.products[].service_tag — required for multi-service businesses.",
    )
    p.add_argument(
        "--marketing-angle",
        default=None,
        help="social_proof | comparison | urgency | utility | educational",
    )

    # ─── ad / creative ────────────────────────────────────────────────────
    p.add_argument("--ad-name", required=True)
    p.add_argument("--creative-kind", choices=["image", "video"], required=True)
    # one of these:
    p.add_argument("--creative-gallery-id", default=None)
    p.add_argument("--image-path", default=None)
    p.add_argument("--video-path", default=None)
    p.add_argument("--existing-post-id", default=None)
    # copy:
    p.add_argument("--copy-headline", required=True, help="≤ 40 chars Hebrew.")
    p.add_argument("--copy-primary-text", required=True, help="80-150 chars Hebrew.")
    p.add_argument("--copy-cta", required=True, help="Meta CTA enum.")
    p.add_argument("--copy-link-url", required=True)
    p.add_argument("--copy-description", default=None)

    # ─── overrides (sane defaults from business_knowledge) ────────────────
    p.add_argument("--age-min", type=int, default=25, help="Default 25 (B2B-friendly).")
    p.add_argument("--age-max", type=int, default=55)
    p.add_argument(
        "--bid-strategy",
        default="LOWEST_COST_WITHOUT_CAP",
        choices=[
            "LOWEST_COST_WITHOUT_CAP",
            "LOWEST_COST_WITH_BID_CAP",
            "COST_CAP",
            "LOWEST_COST_WITH_MIN_ROAS",
        ],
    )
    p.add_argument(
        "--optimization-goal", default=None, help="Override the default for this objective."
    )
    p.add_argument("--billing-event", default="IMPRESSIONS")
    p.add_argument(
        "--special-ad-category",
        default=None,
        choices=[
            "HOUSING",
            "EMPLOYMENT",
            "CREDIT",
            "ISSUES_ELECTIONS_POLITICS",
            "ONLINE_GAMBLING_AND_GAMING",
        ],
        help="Add a single restricted category (rare for Aiweon — usually omit, payload gets []).",
    )
    p.add_argument(
        "--no-advantage-audience",
        action="store_true",
        help="Override the 2026 default of advantage_audience=1. Use only with explicit reason.",
    )

    args = p.parse_args()

    # Validate that exactly one creative_source was provided.
    sources = [
        ("creative_gallery_id", args.creative_gallery_id),
        ("image_path", args.image_path),
        ("video_path", args.video_path),
        ("existing_post_id", args.existing_post_id),
    ]
    set_sources = [(k, v) for k, v in sources if v]
    if len(set_sources) != 1:
        emit_validation_error(
            f"exactly one creative source required, got {len(set_sources)}: "
            f"{[k for k, _ in set_sources]}"
        )
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Pull business + knowledge in one go.
    try:
        biz = with_db_retry(
            lambda: fetch_one(
                """
                SELECT b.id, b.name, b.meta_ad_account_id, b.meta_page_id,
                       b.monthly_budget_ils, b.target_cpl_ils,
                       bk.tracking_pixel_id, bk.service_regions, bk.geo_targeting,
                       bk.products, bk.brand_voice
                  FROM businesses b
             LEFT JOIN business_knowledge bk ON bk.business_id = b.id
                 WHERE b.id = %s
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business lookup failed: {e}", exc=e)
        return

    if not biz:
        emit_validation_error(f"business {args.business_id} not found")
        return

    page_id = biz.get("meta_page_id")
    pixel_id = biz.get("tracking_pixel_id")

    # Validate that for objectives needing page_id / pixel_id, we have them.
    if args.objective in _OBJECTIVES_NEEDING_PAGE and not page_id:
        emit_validation_error(
            f"objective={args.objective} requires businesses.meta_page_id — "
            f"none set for this business. Set it before drafting this campaign."
        )
        return
    if args.objective in _OBJECTIVES_NEEDING_PIXEL and not pixel_id:
        emit_validation_error(
            f"objective={args.objective} requires business_knowledge.tracking_pixel_id — "
            f"none set. Verify Pixel setup before drafting a sales campaign."
        )
        return

    # Validate service_tag exists in products[] when business has multiple products.
    products = biz.get("products") or []
    if isinstance(products, str):
        try:
            products = json.loads(products)
        except (TypeError, ValueError):
            products = []
    if isinstance(products, list) and len(products) > 1 and args.service_tag:
        valid_tags = {p.get("service_tag") for p in products if isinstance(p, dict)}
        if args.service_tag not in valid_tags:
            emit_validation_error(
                f"service_tag={args.service_tag!r} not found in business_knowledge.products. "
                f"Available: {sorted(t for t in valid_tags if t)}"
            )
            return

    # Compose targeting. geo_targeting (migration 025) is the source of truth;
    # service_regions is the legacy country-only fallback when geo_targeting is null.
    geo_locations, excluded_geo_locations = _build_geo_targeting(
        biz.get("geo_targeting"), biz.get("service_regions")
    )
    targeting: dict = {
        "geo_locations": geo_locations,
        "age_min": args.age_min,
        "age_max": args.age_max,
        "targeting_automation": {"advantage_audience": 0 if args.no_advantage_audience else 1},
        "publisher_platforms": ["facebook", "instagram"],
        # Hebrew locale (28) — for an Israeli account this filters out non-Hebrew speakers.
        "locales": [28],
    }
    if excluded_geo_locations:
        targeting["excluded_geo_locations"] = excluded_geo_locations

    # Compose promoted_object based on objective.
    promoted_object: dict = {}
    if args.objective in _OBJECTIVES_NEEDING_PAGE and page_id:
        promoted_object["page_id"] = str(page_id)
    if args.objective in _OBJECTIVES_NEEDING_PIXEL and pixel_id:
        promoted_object["pixel_id"] = str(pixel_id)
        promoted_object["custom_event_type"] = (
            "PURCHASE"  # default; agent can override at propose time
        )
    if args.objective == "OUTCOME_LEADS" and pixel_id:
        # On-website Lead events benefit from pixel reference too (Meta uses both).
        promoted_object["pixel_id"] = str(pixel_id)
        promoted_object["custom_event_type"] = "LEAD"

    creative_source: dict = dict(set_sources)

    # Compose copy.
    copy_block: dict = {
        "headline": args.copy_headline,
        "primary_text": args.copy_primary_text,
        "cta": args.copy_cta,
        "link_url": args.copy_link_url,
    }
    if args.copy_description:
        copy_block["description"] = args.copy_description

    # Compose identity.
    identity_block: dict = {"page_id": str(page_id) if page_id else None}
    # IG actor inferred from page_id linkage at execute time; agent doesn't
    # need to set it explicitly unless overriding.

    # Compose tracking — UTM template that Meta substitutes per ad.
    tracking_block: dict = {
        "url_tags": (
            "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}"
        ),
    }
    if pixel_id:
        tracking_block["pixel_id"] = str(pixel_id)

    # Spend cap default: monthly_budget × 0.5 (per §38 recommendation).
    monthly_budget = biz.get("monthly_budget_ils")
    spend_cap = round(float(monthly_budget) * 0.5, 2) if monthly_budget else None

    payload: dict = {
        # ─── campaign level ───
        "campaign_name": args.campaign_name,
        "objective": args.objective,
        "special_ad_categories": [args.special_ad_category] if args.special_ad_category else [],
        "buying_type": "AUCTION",
        "bid_strategy": args.bid_strategy,
        "spend_cap_ils": spend_cap,
        "daily_budget_ils": args.daily_budget_ils,
        "lifetime_budget_ils": None,
        "start_time_iso": None,
        "stop_time_iso": None,
        # ─── ad set level ───
        "adset_name": f"{args.campaign_name} — Adset 1",
        "optimization_goal": args.optimization_goal or _DEFAULT_OPT_GOAL[args.objective],
        "billing_event": args.billing_event,
        "promoted_object": promoted_object or None,
        "targeting": targeting,
        # ─── ad level ───
        "ad_name": args.ad_name,
        "creative_kind": args.creative_kind,
        "creative_source": creative_source,
        "copy": copy_block,
        "identity": identity_block,
        "tracking": tracking_block,
        # ─── diagnostic metadata ───
        "marketing_angle": args.marketing_angle,
        "service_tag": args.service_tag,
        "hypothesis": args.hypothesis,
    }

    emit_success(
        {
            "business_id": args.business_id,
            "drafted_at": "now",
            "payload": payload,
            "validation_notes": _validation_notes(args, biz, payload),
        }
    )


def _validation_notes(args, biz: dict, payload: dict) -> list[str]:
    """Soft notes to surface to the operator (don't block — §38 catches blockers).
    Things like "advantage_audience disabled — make sure the rationale explains
    why" or "spend_cap is high vs monthly budget — check coherence."""
    notes: list[str] = []
    if args.no_advantage_audience:
        notes.append(
            "advantage_audience=0 — Meta default is on in 2026. Make sure the rationale "
            "explains why you're disabling it (rare valid reason: highly regulated vertical)."
        )
    target_cpl = biz.get("target_cpl_ils")
    if target_cpl and args.objective == "OUTCOME_LEADS":
        # Meta's empirical rule: budget_daily ≥ CPA × 50 / 7 to exit Learning.
        min_budget_for_learning = round(float(target_cpl) * 50 / 7, 2)
        if args.daily_budget_ils < min_budget_for_learning:
            notes.append(
                f"daily_budget {args.daily_budget_ils} ILS is below the formula minimum "
                f"({min_budget_for_learning} ILS = target_cpl × 50 / 7) for exiting Learning. "
                f"Campaign may stay in LEARNING_LIMITED indefinitely."
            )
    if not biz.get("meta_page_id"):
        notes.append(
            "businesses.meta_page_id is null — identity.page_id will be null. "
            "Set it via /settings before approving this proposal."
        )
    monthly_budget = biz.get("monthly_budget_ils")
    if monthly_budget and args.daily_budget_ils * 30 > float(monthly_budget):
        notes.append(
            f"daily_budget × 30 = {args.daily_budget_ils * 30:.0f} ILS exceeds monthly "
            f"budget {monthly_budget} ILS. Either lower daily or raise monthly."
        )
    if not args.service_tag:
        products = biz.get("products") or []
        if isinstance(products, list) and len(products) > 1:
            notes.append(
                "business has multiple products[] but service_tag was not provided. "
                "The copy will be generic — guardrail §37 may flag if a prior rejection "
                "complained about generic-vs-specific service messaging."
            )
    return notes


if __name__ == "__main__":
    main()
