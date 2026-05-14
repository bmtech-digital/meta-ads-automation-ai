"""
Unit + contract tests for `campaigner.tools.estimate_cpl`.

Two layers:
  1. Pure-function tests on `campaigner.lib.cpl_infrastructure` — no DB. These
     verify the multiplier stack, sub-vertical matching, and geo routing match
     the TypeScript implementation in `web/src/lib/cpl-infrastructure.ts`
     (Python ↔ TS parity asserted with the canonical Aiweon worked example).
  2. CLI contract tests on the tool itself — missing args, bad enum values.

The DB-backed happy path (live business_id with a real business_knowledge
row) is exercised by golden tests, not here, because it requires a seeded
local Postgres and the contract layer here is what `test_contract.py` covers
for every tool.
"""

from __future__ import annotations

from campaigner.lib.cpl_infrastructure import (
    GEO_MODIFIER,
    OFFER_MODIFIER,
    PRIMARY_SOURCES,
    SECURITY_EVENT_MULTIPLIER,
    STAGE_MODIFIER,
    SUBVERTICALS,
    Channel,
    EstimateInput,
    FunnelStage,
    GeoTier,
    OfferType,
    SubVertical,
    estimate_cpl,
    is_generic_campaign_name,
    match_sub_vertical,
    month_of,
    pick_geo_tier,
)

# ─────────────────────────────────────────────────────────────────────
# Pure-function parity with TypeScript
# ─────────────────────────────────────────────────────────────────────


class TestEstimateCPLArithmetic:
    def test_default_inputs_return_base(self):
        # saas_marketing_tech base=420; all modifiers=1.0 → 420.
        r = estimate_cpl(
            EstimateInput(
                sub=SubVertical.SAAS_MARKETING_TECH,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.LEAD_FORM,
                month="mar",
                security_event=False,
            )
        )
        assert r.value_ils == 420
        assert r.is_cpa is False

    def test_aiweon_canonical_demo_lead_form_all_il_march(self):
        """
        Worked example documented in cpl-infrastructure.md §12 and mirrored in
        the TS test suite. Both implementations must produce 756.

        base=420 × geo[il_all_country]=1.0 × stage[cold]=1.0
              × offer[demo_request]=1.8 × channel[lead_form]=1.0 × season[mar]=1.0
        = 756
        """
        r = estimate_cpl(
            EstimateInput(
                sub=SubVertical.SAAS_MARKETING_TECH,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.DEMO_REQUEST,
                channel=Channel.LEAD_FORM,
                month="mar",
                security_event=False,
            )
        )
        assert r.value_ils == 756

    def test_ctwa_channel_discount(self):
        """CTWA modifier 0.55 — biggest single lever in IL B2C."""
        base = estimate_cpl(
            EstimateInput(
                sub=SubVertical.HOME_SERVICES,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.LEAD_FORM,
                month="mar",
                security_event=False,
            )
        )
        ctwa = estimate_cpl(
            EstimateInput(
                sub=SubVertical.HOME_SERVICES,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.CLICK_TO_WHATSAPP,
                month="mar",
                security_event=False,
            )
        )
        assert ctwa.value_ils == round(base.value_ils * 0.55)

    def test_security_event_compounds_on_seasonal(self):
        calm = estimate_cpl(
            EstimateInput(
                sub=SubVertical.REAL_ESTATE_RESIDENTIAL,
                geo=GeoTier.IL_TEL_AVIV_CENTER,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.LEAD_FORM,
                month="nov",  # peak ×1.15
                security_event=False,
            )
        )
        conflict = estimate_cpl(
            EstimateInput(
                sub=SubVertical.REAL_ESTATE_RESIDENTIAL,
                geo=GeoTier.IL_TEL_AVIV_CENTER,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.LEAD_FORM,
                month="nov",
                security_event=True,
            )
        )
        # ±1 rounding tolerance — calm is already rounded once.
        assert abs(conflict.value_ils - calm.value_ils * 2) <= 1

    def test_ecommerce_subvertical_treated_as_cpa(self):
        r = estimate_cpl(
            EstimateInput(
                sub=SubVertical.ECOM_FASHION,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.PURCHASE,
                channel=Channel.CLICK_TO_WEBSITE,
                month="mar",
                security_event=False,
            )
        )
        assert r.is_cpa is True

    def test_citations_count_ge_2_for_high_confidence_cells(self):
        """Guardrail §26 needs ≥2 sources. saas_marketing_tech has 3 — confirm."""
        r = estimate_cpl(
            EstimateInput(
                sub=SubVertical.SAAS_MARKETING_TECH,
                geo=GeoTier.IL_ALL_COUNTRY,
                stage=FunnelStage.COLD,
                offer=OfferType.DEMO_REQUEST,
                channel=Channel.LEAD_FORM,
                month="mar",
                security_event=False,
            )
        )
        assert len(r.citations) >= 2
        for c in r.citations:
            assert c.title
            assert c.url
            assert len(c.extracted) > 20

    def test_trace_records_every_step(self):
        r = estimate_cpl(
            EstimateInput(
                sub=SubVertical.LEGAL_PERSONAL,
                geo=GeoTier.IL_TEL_AVIV_CENTER,
                stage=FunnelStage.COLD,
                offer=OfferType.CONSULTATION_FREE,
                channel=Channel.LEAD_FORM,
                month="nov",
                security_event=False,
            )
        )
        steps = [t.step for t in r.trace]
        assert any("base" in s for s in steps)
        assert any("geo[il_tel_aviv_center]" in s for s in steps)
        assert any("season[nov]" in s for s in steps)


# ─────────────────────────────────────────────────────────────────────
# Sub-vertical matching
# ─────────────────────────────────────────────────────────────────────


class TestMatchSubVertical:
    def test_aiweon_input_matches_saas_marketing_tech(self):
        r = match_sub_vertical(
            vertical="b2b_saas",
            products_raw="פלטפורמת משפיענים לעסקים — influencer marketing platform",
            ideal_customer="מנהלי שיווק בעסקים B2C",
            usp="אוטומציה של קמפיינים שיווקיים",
            main_pain=None,
        )
        assert r.sub == SubVertical.SAAS_MARKETING_TECH
        assert r.confidence_of_match == "exact"

    def test_no_inputs_falls_back_to_other(self):
        r = match_sub_vertical(
            vertical=None,
            products_raw=None,
            ideal_customer=None,
            usp=None,
            main_pain=None,
        )
        assert r.sub == SubVertical.OTHER
        assert r.confidence_of_match == "fallback"

    def test_parent_vertical_respected(self):
        """If vertical=leads, won't match saas_* cells even on overlapping terms."""
        r = match_sub_vertical(
            vertical="leads",
            products_raw="marketing platform for influencer campaigns",
            ideal_customer=None,
            usp=None,
            main_pain=None,
        )
        assert SUBVERTICALS[r.sub].parent != "b2b_saas"

    def test_campaign_name_dominates_aggregate(self):
        """
        AIWEON has 4 services. Business-level products lists all four (post
        importer, the 4 AIWEON service names land in `products_raw`). Without
        --campaign-name, the matcher picks `agency_services` (where all 4
        AIWEON services route). The matched_terms reveal which specific
        services hit, so rationale can be product-specific.

        With a campaign-name like "קמפיין משפיעות", the matcher must reflect
        that term in matched_terms (boosted ×3). Different campaign names
        produce matched_terms that show which service the campaign is about.
        """
        common = {
            "vertical": None,
            "products_raw": (
                "סוכני AI — צ'אט שמדבר עברית רהוטה  "
                "סרטוני AI — סרטוני שיווק קולנועיים  "
                "קמפיינים AI — אופטימיזציית קמפיינים  "
                "מיתוג משפיעות — שיתופי פעולה עם משפיעות"
            ),
            "ideal_customer": None,
            "usp": None,
            "main_pain": None,
        }
        # Without campaign-name — aggregate match. All 4 AIWEON services
        # route to agency_services. Should not be OTHER now.
        baseline = match_sub_vertical(**common)
        assert baseline.sub != SubVertical.OTHER, (
            f"baseline match should hit a real sub-vertical, got "
            f"{baseline.sub.value} (matched: {baseline.matched_terms})"
        )
        # WITH campaign name pointing at a specific service — that term
        # should appear in matched_terms (boosted ×3).
        agents_campaign = match_sub_vertical(**common, campaign_name="סוכן AI לאתר B2B")
        assert (
            "סוכן AI" in agents_campaign.matched_terms
            or "AI agent" in agents_campaign.matched_terms
        ), f"campaign 'סוכן AI' should bias matched_terms, got {agents_campaign.matched_terms}"
        videos_campaign = match_sub_vertical(**common, campaign_name="סרטון AI להשקה")
        # Should find the videos term either as "סרטון AI" or "סרטוני AI"
        # depending on how the matcher tokenizes (we use `in` substring).
        videos_matched = " ".join(videos_campaign.matched_terms)
        assert "AI" in videos_matched and (
            "סרטון" in videos_matched or "video" in videos_matched.lower()
        ), (
            f"campaign 'סרטון AI' should surface a video-related term, got "
            f"{videos_campaign.matched_terms}"
        )

    def test_campaign_name_alone_is_enough(self):
        """When products are empty but campaign name has a clear term, match."""
        r = match_sub_vertical(
            vertical=None,
            products_raw=None,
            ideal_customer=None,
            usp=None,
            main_pain=None,
            campaign_name="קמפיין לסוכן ביטוח חדש",
        )
        assert r.sub == SubVertical.INSURANCE_AGENT
        # 1 campaign hit × 3 weight = 3 → exact
        assert r.confidence_of_match == "exact"


# ─────────────────────────────────────────────────────────────────────
# Geo tier routing
# ─────────────────────────────────────────────────────────────────────


class TestPickGeoTier:
    def test_tlv_dominates(self):
        assert pick_geo_tier(["תל אביב", "באר שבע"]) == GeoTier.IL_TEL_AVIV_CENTER

    def test_empty_default_all_country(self):
        assert pick_geo_tier(None) == GeoTier.IL_ALL_COUNTRY
        assert pick_geo_tier([]) == GeoTier.IL_ALL_COUNTRY

    def test_multi_periphery_returns_mixed(self):
        assert pick_geo_tier(["באר שבע", "טבריה"]) == GeoTier.IL_PERIPHERY_MIXED

    def test_single_region(self):
        assert pick_geo_tier(["חיפה"]) == GeoTier.IL_HAIFA


# ─────────────────────────────────────────────────────────────────────
# Modifier table integrity
# ─────────────────────────────────────────────────────────────────────


class TestModifierTables:
    def test_all_modifiers_positive(self):
        for table in (GEO_MODIFIER, STAGE_MODIFIER, OFFER_MODIFIER):
            for v in table.values():
                assert v > 0

    def test_security_event_is_2(self):
        assert SECURITY_EVENT_MULTIPLIER == 2.0

    def test_every_primary_source_has_extracted_quote(self):
        for sid, s in PRIMARY_SOURCES.items():
            assert s.title, f"empty title for {sid}"
            assert s.url, f"empty url for {sid}"
            assert len(s.extracted) > 20, f"thin extracted for {sid}"

    def test_every_subvertical_has_match_terms_or_is_other(self):
        for sub, cell in SUBVERTICALS.items():
            if sub == SubVertical.OTHER:
                continue
            assert len(cell.match_terms) > 0, f"no match_terms for {sub.value}"

    def test_every_subvertical_cites_at_least_one_source_or_is_other(self):
        for sub, cell in SUBVERTICALS.items():
            if sub == SubVertical.OTHER:
                continue
            assert len(cell.primary_source_ids) >= 1
            for sid in cell.primary_source_ids:
                assert sid in PRIMARY_SOURCES, f"unknown source id {sid} on {sub.value}"


class TestMonthOf:
    def test_basic_mapping(self):
        assert month_of(1) == "jan"
        assert month_of(11) == "nov"
        assert month_of(12) == "dec"


class TestIsGenericCampaignName:
    """F7 (2026-05-13) — detect uninformative campaign names so §T-2
    can auto-propose a rename alert. False positives are worse than
    false negatives (a real name flagged as generic = annoying alert);
    aim for precision."""

    def test_empty_or_whitespace_is_generic(self):
        for v in (None, "", "   ", "\t", "..."):
            ok, reason = is_generic_campaign_name(v)
            assert ok is True, f"{v!r} should be generic"
            assert reason

    def test_short_names_flagged(self):
        ok, _ = is_generic_campaign_name("abc")
        assert ok is True
        ok, _ = is_generic_campaign_name("AB")
        assert ok is True

    def test_canonical_garbage_patterns(self):
        for v in (
            "Campaign",
            "Campaign 1",
            "campaign 42",
            "test",
            "test 3",
            "Untitled",
            "untitled",
            "new campaign",
            "New Campaign",
            "12345",
            "999",
        ):
            ok, _ = is_generic_campaign_name(v)
            assert ok is True, f"{v!r} should be generic"

    def test_descriptive_names_pass(self):
        for v in (
            "סוכן AI - שלב 1",
            "Brand Awareness Q2 2026",
            "מיתוג משפיעות - אביב",
            "סרטון AI דמו",
            "AIWEON Lead Gen",
        ):
            ok, reason = is_generic_campaign_name(v)
            assert ok is False, f"{v!r} should pass (got reason={reason})"

    def test_dollar_date_placeholders_flagged(self):
        for v in ("$DATE", "$date - campaign"):
            ok, _ = is_generic_campaign_name(v)
            assert ok is True, f"{v!r} should be generic"


# ─────────────────────────────────────────────────────────────────────
# CLI contract
# ─────────────────────────────────────────────────────────────────────


def test_estimate_cpl_help_exits_0(invoke_tool):
    r = invoke_tool("estimate_cpl", "--help")
    assert r.returncode == 0, f"stderr: {r.stderr}"
    assert "business-id" in r.stdout.lower() or "business-id" in r.stderr.lower()


def test_estimate_cpl_missing_business_id_exits_2(invoke_tool):
    r = invoke_tool("estimate_cpl")
    assert r.returncode == 2
    assert r.stderr


def test_estimate_cpl_invalid_stage_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "estimate_cpl",
        "--business-id",
        business_id,
        "--stage",
        "bogus_stage",
    )
    assert r.returncode == 2


def test_estimate_cpl_invalid_offer_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "estimate_cpl",
        "--business-id",
        business_id,
        "--offer",
        "not_an_offer",
    )
    assert r.returncode == 2
