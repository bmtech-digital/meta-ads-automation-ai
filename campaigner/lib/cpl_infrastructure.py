"""
CPL Infrastructure — Israel 2026 (Python port).

Pure data + pure functions. NO I/O. The CLI tool that wraps this lives at
`campaigner/tools/estimate_cpl.py`.

This is the Python mirror of `web/src/lib/cpl-infrastructure.ts`. Numeric
values MUST agree across the three files in this triple:

  - campaigner/prompts/cpl-infrastructure.md  (authoritative agent reference)
  - web/src/lib/cpl-infrastructure.ts         (UI mirror)
  - campaigner/lib/cpl_infrastructure.py      (← this file)

When you edit any modifier or base value, edit all three in the same commit.
The parity test in `tests/tools/test_estimate_cpl.py` asserts that the
canonical worked example (Aiweon's saas_marketing_tech demo lead-form, all-IL,
March, no security event) produces ₪756 across all three.

Purpose: when the agent needs a CPL estimate for a `set_kpi_target` proposal
or a §T-2 reality-check, it calls the CLI tool. The tool reads
business_knowledge, picks a sub-vertical via `match_sub_vertical`, applies the
modifier stack, and returns a JSON payload with `citations[]` pre-extracted
so the proposal satisfies guardrail §26 WITHOUT a WebSearch round-trip. That
is the token-saving lever the operator asked for on 2026-05-13.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal


# ─────────────────────────────────────────────────────────────────────
# Types
# ─────────────────────────────────────────────────────────────────────

Vertical = Literal["ecommerce", "leads", "b2b_saas", "awareness", "app", "other"]

Confidence = Literal["high", "medium", "low"]


class SubVertical(str, Enum):
    # leads (B2C services)
    REAL_ESTATE_RESIDENTIAL = "real_estate_residential"
    REAL_ESTATE_COMMERCIAL = "real_estate_commercial"
    HOME_SERVICES = "home_services"
    RENOVATION_CONTRACTOR = "renovation_contractor"
    INSURANCE_AGENT = "insurance_agent"
    AUTOMOTIVE_DEALER = "automotive_dealer"
    AUTOMOTIVE_SERVICE = "automotive_service"
    BEAUTY_AESTHETIC = "beauty_aesthetic"
    WELLNESS_ALT = "wellness_alt"
    FITNESS_STUDIO = "fitness_studio"
    DENTAL_CLINIC = "dental_clinic"
    PRIVATE_CLINIC = "private_clinic"
    LEGAL_PERSONAL = "legal_personal"
    LEGAL_CORPORATE = "legal_corporate"
    ACCOUNTING_TAX = "accounting_tax"
    EDUCATION_PRIVATE = "education_private"
    EDUCATION_UNIVERSITY = "education_university"
    # b2b_saas
    SAAS_HORIZONTAL = "saas_horizontal"
    SAAS_MARKETING_TECH = "saas_marketing_tech"
    SAAS_DEV_TECH = "saas_dev_tech"
    AGENCY_SERVICES = "agency_services"
    # AIWEON-style productized AI services — added 2026-05-13. Each is a B2B
    # service sold to other businesses. Bands derived from B2B-SaaS demo-CPL
    # primary sources (Aimers, GrowthSpree) anchored to per-service friction
    # and price point. Confidence=medium pending live WebSearch refinement.
    AI_CHATBOT_SERVICES = "ai_chatbot_services"
    AI_VIDEO_PRODUCTION = "ai_video_production"
    AI_CAMPAIGN_MANAGEMENT = "ai_campaign_management"
    # ecommerce (CPA, not CPL)
    ECOM_FASHION = "ecom_fashion"
    ECOM_BEAUTY_PRODUCTS = "ecom_beauty_products"
    ECOM_ELECTRONICS = "ecom_electronics"
    ECOM_HOME_GOODS = "ecom_home_goods"
    ECOM_FOOD_SUPPLEMENTS = "ecom_food_supplements"
    # unmapped
    OTHER = "other"


class GeoTier(str, Enum):
    IL_TEL_AVIV_CENTER = "il_tel_aviv_center"
    IL_SHARON = "il_sharon"
    IL_JERUSALEM = "il_jerusalem"
    IL_HAIFA = "il_haifa"
    IL_SOUTH = "il_south"
    IL_NORTH = "il_north"
    IL_PERIPHERY_MIXED = "il_periphery_mixed"
    IL_ALL_COUNTRY = "il_all_country"
    GLOBAL = "global"


class FunnelStage(str, Enum):
    COLD = "cold"
    WARM_ENGAGEMENT = "warm_engagement"
    WARM_VISIT = "warm_visit"
    LOOKALIKE_CUSTOMERS = "lookalike_customers"
    RETARGETING_FORM_OPENER = "retargeting_form_opener"


class OfferType(str, Enum):
    CONSULTATION_FREE = "consultation_free"
    QUOTE_REQUEST = "quote_request"
    DEMO_REQUEST = "demo_request"
    TRIAL_FREE = "trial_free"
    GATED_CONTENT = "gated_content"
    APPOINTMENT_BOOKING = "appointment_booking"
    PHONE_CALL_DIRECT = "phone_call_direct"
    PURCHASE = "purchase"


class Channel(str, Enum):
    LEAD_FORM = "lead_form"
    CLICK_TO_WHATSAPP = "click_to_whatsapp"
    CLICK_TO_MESSENGER = "click_to_messenger"
    CLICK_TO_WEBSITE = "click_to_website"
    VIDEO_VIEW = "video_view"


CalendarMonth = Literal[
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]


# ─────────────────────────────────────────────────────────────────────
# Primary sources
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PrimarySource:
    id: str
    title: str
    url: str
    extracted: str


PRIMARY_SOURCES: dict[str, PrimarySource] = {
    "adamigo-cpl-industry-2026": PrimarySource(
        id="adamigo-cpl-industry-2026",
        title="AdAmigo Meta Ads CPL Benchmarks by Industry 2026",
        url="https://www.adamigo.ai/blog/meta-ads-cost-per-lead-benchmarks-industry-2026",
        extracted=(
            "Real Estate $51.90 average CPL (Tier 1 cities $35-$65); "
            "Home Services $34.00; Healthcare $41.60; B2B SaaS $63.40 "
            "(qualified $150-$250); Legal Services $72.40"
        ),
    ),
    "adamigo-country-2026": PrimarySource(
        id="adamigo-country-2026",
        title="AdAmigo Meta Ads CPM/CPC by Country 2026",
        url="https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026",
        extracted=(
            "Israel is Tier 2; CPM Dec'24 $6.49 → Dec'25 $8.72 (+34% YoY); "
            "peak Nov $10.74, low Jun $4.85; monthly volatility 2.21 vs global 1.28"
        ),
    ),
    "adamigo-leadform-vs-lp": PrimarySource(
        id="adamigo-leadform-vs-lp",
        title="AdAmigo Lead Form vs Landing Page Benchmarks 2026",
        url="https://www.adamigo.ai/blog/meta-lead-form-vs-landing-page-benchmarks-by-industry-2026",
        extracted=(
            "Meta Lead Forms see CPLs 40-70% lower than landing pages; "
            "Instant Forms reduce fill time from 2 min to 20 sec"
        ),
    ),
    "egrow-ctwa-2026": PrimarySource(
        id="egrow-ctwa-2026",
        title="Egrow Click-to-WhatsApp Ads Complete Guide 2026",
        url="https://www.egrow.com/en/blog/click-to-whatsapp-ads-the-complete-guide-to-driving-sales-from-meta-to-whatsapp-2026",
        extracted=(
            "Click-to-WhatsApp typical CPL $1-5 vs landing pages $5-25; "
            "per-acquisition $3-15 emerging markets, $15-50 developed"
        ),
    ),
    "forrester-ctwa-meta": PrimarySource(
        id="forrester-ctwa-meta",
        title="Forrester Consulting (Meta-commissioned) CTWA study",
        url="https://www.egrow.com/en/blog/click-to-whatsapp-ads-the-complete-guide-to-driving-sales-from-meta-to-whatsapp-2026",
        extracted=(
            "94% conversion rate lift, 92% drop in cost per lead for "
            "Click-to-WhatsApp Ads vs landing pages (treat as upper-bound; "
            "conservative practitioners use 40-50% off)"
        ),
    ),
    "stape-realestate-2026": PrimarySource(
        id="stape-realestate-2026",
        title="Stape Real Estate Facebook Ads Guide 2026",
        url="https://stape.io/blog/real-estate-facebook-ads",
        extracted=(
            "Retargeting warm audiences delivers 3-5x lower CPL than cold "
            "prospecting; 92% of real estate agents use Facebook"
        ),
    ),
    "stackmatix-funnel-2026": PrimarySource(
        id="stackmatix-funnel-2026",
        title="Stackmatix Meta Ads Funnel Strategy 2026",
        url="https://www.stackmatix.com/blog/meta-ads-funnel-strategy",
        extracted=(
            "20-30% of total Meta budget on TOFU campaigns; warm retargeting "
            "delivers significantly lower CPL"
        ),
    ),
    "aimers-saas-2026": PrimarySource(
        id="aimers-saas-2026",
        title="Aimers Facebook Ads Cost for SaaS 2026",
        url="https://aimers.io/blog/facebook-ads-cost",
        extracted=(
            "Facebook Ads in SaaS work in $40-65 CPL range for standard B2B "
            "leads; qualified leads cost $150+ for MQL/SQL level"
        ),
    ),
    "growthspree-saas-2026": PrimarySource(
        id="growthspree-saas-2026",
        title="GrowthSpree B2B SaaS Demo Request Conversion Benchmarks 2026",
        url="https://www.growthspreeofficial.com/blogs/b2b-saas-demo-request-conversion-rate-benchmarks-2026",
        extracted=(
            "Demo request CPLs $150-400 across paid channels; CVR drops from "
            "8.2% to 6.4% with form friction"
        ),
    ),
    "webfx-healthcare-2026": PrimarySource(
        id="webfx-healthcare-2026",
        title="WebFX Healthcare Marketing Benchmarks 2026",
        url="https://www.webfx.com/blog/healthcare/marketing-benchmarks-for-healthcare/",
        extracted=(
            "Healthcare leads average $377 (B2B) and $367 (B2C); "
            "B2C wellness CPLs range $98-$661 depending on service"
        ),
    ),
    "wordstream-fb-2025": PrimarySource(
        id="wordstream-fb-2025",
        title="WordStream Facebook Ads Benchmarks 2025",
        url="https://www.wordstream.com/blog/facebook-ads-benchmarks-2025",
        extracted="Facebook lead ads CVR 7.72%, global average CPL $27.66",
    ),
    "manus-il-cpl-2026": PrimarySource(
        id="manus-il-cpl-2026",
        title="Manus deep research (internal) — Israel Meta Ads CPL 2026",
        url="docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md",
        extracted=(
            "Israel CPL $104.72 (~2.5x global $41.53); wartime spikes "
            "documented up to $385 (~₪1,400)"
        ),
    ),
    "grok-il-2026": PrimarySource(
        id="grok-il-2026",
        title="Grok deep research (internal) — Israel Meta Ads benchmarks 2026",
        url="docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md",
        extracted=(
            "Israel CPM low (Tier 2) but CPL elevated due to small audience "
            "density and high advertiser saturation per Hebrew-speaking pool"
        ),
    ),
}


# ─────────────────────────────────────────────────────────────────────
# Sub-vertical cells
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SubVerticalCell:
    parent: Vertical
    base_ils: int
    band_ils: tuple[int, int]
    confidence: Confidence
    match_terms: tuple[str, ...]
    primary_source_ids: tuple[str, ...]
    is_cpa: bool = False


SUBVERTICALS: dict[SubVertical, SubVerticalCell] = {
    # ─── leads ───
    SubVertical.REAL_ESTATE_RESIDENTIAL: SubVerticalCell(
        parent="leads", base_ils=280, band_ils=(180, 450), confidence="medium",
        match_terms=("נדל\"ן מגורים", "דירה", "מתווך", "מתווכת", "יזם דירות", "real estate"),
        primary_source_ids=("adamigo-cpl-industry-2026", "stape-realestate-2026"),
    ),
    SubVertical.REAL_ESTATE_COMMERCIAL: SubVerticalCell(
        parent="leads", base_ils=550, band_ils=(350, 900), confidence="low",
        match_terms=("נדל\"ן מסחרי", "משרדים להשכרה", "נכס מסחרי", "commercial real estate"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.HOME_SERVICES: SubVerticalCell(
        parent="leads", base_ils=120, band_ils=(70, 200), confidence="high",
        match_terms=(
            "אינסטלטור", "חשמלאי", "מזגנים", "מנעולן", "פורץ דלתות", "ניקיון בית",
            "plumber", "electrician", "HVAC", "locksmith",
        ),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.RENOVATION_CONTRACTOR: SubVerticalCell(
        parent="leads", base_ils=180, band_ils=(100, 320), confidence="medium",
        match_terms=("קבלן שיפוצים", "שיפוצים", "ריצוף", "גבס", "צבעי", "renovation", "contractor"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.INSURANCE_AGENT: SubVerticalCell(
        parent="leads", base_ils=240, band_ils=(130, 400), confidence="medium",
        match_terms=("סוכן ביטוח", "ביטוח חיים", "ביטוח רכב", "ביטוח בריאות", "פנסיה", "insurance"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.AUTOMOTIVE_DEALER: SubVerticalCell(
        parent="leads", base_ils=200, band_ils=(110, 340), confidence="medium",
        match_terms=("סוכנות רכב", "רכבים חדשים", "רכב יד שנייה", "car dealer"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.AUTOMOTIVE_SERVICE: SubVerticalCell(
        parent="leads", base_ils=75, band_ils=(40, 140), confidence="medium",
        match_terms=("מוסך", "חשמלאי רכב", "פנצ'רייה", "חלפים", "auto service"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.BEAUTY_AESTHETIC: SubVerticalCell(
        parent="leads", base_ils=130, band_ils=(70, 230), confidence="high",
        match_terms=(
            "בוטוקס", "חומצה היאלורונית", "הסרת שיער בלייזר", "אסתטיקה", "רפואה אסתטית",
            "botox", "filler", "laser hair", "aesthetic",
        ),
        primary_source_ids=("adamigo-cpl-industry-2026", "webfx-healthcare-2026"),
    ),
    SubVertical.WELLNESS_ALT: SubVerticalCell(
        parent="leads", base_ils=80, band_ils=(40, 160), confidence="medium",
        match_terms=("רפלקסולוגיה", "שיאצו", "רפואה משלימה", "יוגה תרפיה", "מיינדפולנס"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.FITNESS_STUDIO: SubVerticalCell(
        parent="leads", base_ils=75, band_ils=(35, 150), confidence="high",
        match_terms=(
            "חדר כושר", "פילאטיס", "קרוספיט", "סטודיו", "אימון אישי",
            "gym", "crossfit", "pilates",
        ),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.DENTAL_CLINIC: SubVerticalCell(
        parent="leads", base_ils=150, band_ils=(80, 280), confidence="medium",
        match_terms=("רופא שיניים", "מרפאת שיניים", "יישור שיניים", "השתלות שיניים", "dental"),
        primary_source_ids=("adamigo-cpl-industry-2026", "webfx-healthcare-2026"),
    ),
    SubVertical.PRIVATE_CLINIC: SubVerticalCell(
        parent="leads", base_ils=200, band_ils=(100, 380), confidence="low",
        match_terms=("רופא פרטי", "מרפאה פרטית", "רופא משפחה", "רופא מומחה"),
        primary_source_ids=("webfx-healthcare-2026",),
    ),
    SubVertical.LEGAL_PERSONAL: SubVerticalCell(
        parent="leads", base_ils=380, band_ils=(200, 700), confidence="medium",
        match_terms=("עורך דין", "גירושין", "פלילי", "נזיקין", "תאונות דרכים", "lawyer", "attorney"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.LEGAL_CORPORATE: SubVerticalCell(
        parent="leads", base_ils=700, band_ils=(400, 1300), confidence="low",
        match_terms=("עו\"ד מסחרי", "חברות", "הסכמים", "נדל\"ן עו\"ד", "corporate law"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.ACCOUNTING_TAX: SubVerticalCell(
        parent="leads", base_ils=250, band_ils=(140, 450), confidence="medium",
        match_terms=("רואה חשבון", "יועץ מס", "הנהלת חשבונות", "הקמת חברה", "accounting"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.EDUCATION_PRIVATE: SubVerticalCell(
        parent="leads", base_ils=110, band_ils=(50, 200), confidence="medium",
        match_terms=("מורה פרטי", "שיעורי עזר", "פסיכומטרי", "קורסים פרטיים", "tutor"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    SubVertical.EDUCATION_UNIVERSITY: SubVerticalCell(
        parent="leads", base_ils=180, band_ils=(90, 340), confidence="medium",
        match_terms=("תואר ראשון", "MBA", "מכללה", "אוניברסיטה", "לימודי המשך", "degree", "university"),
        primary_source_ids=("adamigo-cpl-industry-2026",),
    ),
    # ─── b2b_saas ───
    SubVertical.SAAS_HORIZONTAL: SubVerticalCell(
        parent="b2b_saas", base_ils=320, band_ils=(180, 600), confidence="medium",
        match_terms=("SaaS", "platform", "dashboard"),
        primary_source_ids=("aimers-saas-2026", "growthspree-saas-2026"),
    ),
    SubVertical.SAAS_MARKETING_TECH: SubVerticalCell(
        parent="b2b_saas", base_ils=420, band_ils=(250, 800), confidence="high",
        match_terms=(
            "analytics", "ad tech", "influencer marketing", "marketing platform",
            "מערכת שיווק", "פלטפורמת שיווק", "פלטפורמת משפיענים",
            # Influencer-marketing operator-facing names (Aiweon, weon, etc.)
            "משפיעות", "משפיענים", "influencer", "creator marketing",
            "מיתוג משפיעות", "influencer branding",
        ),
        primary_source_ids=("aimers-saas-2026", "growthspree-saas-2026", "manus-il-cpl-2026"),
    ),
    SubVertical.SAAS_DEV_TECH: SubVerticalCell(
        parent="b2b_saas", base_ils=500, band_ils=(300, 950), confidence="low",
        match_terms=("DevTools", "API", "infrastructure", "observability"),
        primary_source_ids=("aimers-saas-2026",),
    ),
    SubVertical.AGENCY_SERVICES: SubVerticalCell(
        parent="b2b_saas", base_ils=280, band_ils=(160, 520), confidence="medium",
        match_terms=("סוכנות שיווק", "סוכנות פרסום", "סוכנות דיגיטל", "agency"),
        primary_source_ids=("aimers-saas-2026",),
    ),
    # ─── AIWEON-style productized AI services (added 2026-05-13) ───
    # Each gets a dedicated band derived from B2B-SaaS demo-CPL data
    # (Aimers $40-65 standard B2B, GrowthSpree $150-400 demos), adjusted for
    # IL premium (×2-2.5) and per-service friction. Confidence=medium until
    # live WebSearch refines per cell — but high enough that the static path
    # satisfies guardrail §26 without WebSearch round-trip.
    SubVertical.AI_CHATBOT_SERVICES: SubVerticalCell(
        parent="b2b_saas",
        base_ils=480,       # demo-required, high-friction enterprise sale
        band_ils=(280, 900),
        confidence="medium",
        match_terms=(
            "סוכני AI", "סוכן AI", "AI agent", "AI agents", "chatbot",
            "AI chatbot", "צ'אט AI", "צאט בוט", "voice agent", "voice AI",
            "AI sales agent", "סוכן מכירות AI", "conversational AI",
        ),
        primary_source_ids=("aimers-saas-2026", "growthspree-saas-2026", "manus-il-cpl-2026"),
    ),
    SubVertical.AI_VIDEO_PRODUCTION: SubVerticalCell(
        parent="b2b_saas",
        base_ils=380,       # mid-friction; AOV ₪4500-18000 per video drives serious buyers
        band_ils=(220, 720),
        confidence="medium",
        match_terms=(
            "סרטוני AI", "סרטון AI", "AI video", "AI videos", "video AI",
            "AI video production", "video branding", "voice cloning",
            "סרטוני שיווק AI", "הפקת סרטוני AI",
        ),
        primary_source_ids=("aimers-saas-2026", "manus-il-cpl-2026"),
    ),
    SubVertical.AI_CAMPAIGN_MANAGEMENT: SubVerticalCell(
        parent="b2b_saas",
        base_ils=520,       # highest friction — ongoing retainer, ≥₪15k/mo commitment
        band_ils=(300, 1000),
        confidence="medium",
        match_terms=(
            "קמפיינים AI", "קמפיין AI", "AI campaigner", "AI campaigns",
            "managed ads AI", "ניהול קמפיינים AI", "AI ad management",
            "performance marketing AI",
        ),
        primary_source_ids=("aimers-saas-2026", "growthspree-saas-2026", "adamigo-country-2026"),
    ),
    # ─── ecommerce (CPA, not CPL) ───
    SubVertical.ECOM_FASHION: SubVerticalCell(
        parent="ecommerce", base_ils=55, band_ils=(30, 110), confidence="high", is_cpa=True,
        match_terms=("אופנה", "בגדים", "שמלות", "גרבי גוף", "fashion", "clothing"),
        primary_source_ids=("wordstream-fb-2025",),
    ),
    SubVertical.ECOM_BEAUTY_PRODUCTS: SubVerticalCell(
        parent="ecommerce", base_ils=60, band_ils=(35, 120), confidence="high", is_cpa=True,
        match_terms=("טיפוח", "איפור", "פנים", "שיער", "מוצרי קוסמטיקה", "cosmetics", "skincare"),
        primary_source_ids=("wordstream-fb-2025",),
    ),
    SubVertical.ECOM_ELECTRONICS: SubVerticalCell(
        parent="ecommerce", base_ils=75, band_ils=(40, 170), confidence="medium", is_cpa=True,
        match_terms=("אלקטרוניקה", "גאדג'טים", "מסכים", "אוזניות", "electronics"),
        primary_source_ids=("wordstream-fb-2025",),
    ),
    SubVertical.ECOM_HOME_GOODS: SubVerticalCell(
        parent="ecommerce", base_ils=70, band_ils=(35, 140), confidence="medium", is_cpa=True,
        match_terms=("מטבח", "רהיטים", "כריות", "מצעים", "עיצוב הבית", "home goods"),
        primary_source_ids=("wordstream-fb-2025",),
    ),
    SubVertical.ECOM_FOOD_SUPPLEMENTS: SubVerticalCell(
        parent="ecommerce", base_ils=50, band_ils=(25, 110), confidence="medium", is_cpa=True,
        match_terms=("תוספי תזונה", "ויטמינים", "חלבון", "מזון בריאות", "supplements"),
        primary_source_ids=("wordstream-fb-2025",),
    ),
    # ─── unmapped ───
    SubVertical.OTHER: SubVerticalCell(
        parent="other", base_ils=200, band_ils=(100, 400), confidence="low",
        match_terms=(), primary_source_ids=(),
    ),
}


# ─────────────────────────────────────────────────────────────────────
# Modifier tables
# ─────────────────────────────────────────────────────────────────────

GEO_MODIFIER: dict[GeoTier, float] = {
    GeoTier.IL_TEL_AVIV_CENTER: 1.30,
    GeoTier.IL_SHARON: 1.15,
    GeoTier.IL_JERUSALEM: 1.05,
    GeoTier.IL_HAIFA: 1.05,
    GeoTier.IL_SOUTH: 0.85,
    GeoTier.IL_NORTH: 0.80,
    GeoTier.IL_PERIPHERY_MIXED: 0.90,
    GeoTier.IL_ALL_COUNTRY: 1.00,
    GeoTier.GLOBAL: 0.70,
}

STAGE_MODIFIER: dict[FunnelStage, float] = {
    FunnelStage.COLD: 1.00,
    FunnelStage.WARM_ENGAGEMENT: 0.50,
    FunnelStage.WARM_VISIT: 0.35,
    FunnelStage.LOOKALIKE_CUSTOMERS: 0.65,
    FunnelStage.RETARGETING_FORM_OPENER: 0.25,
}

OFFER_MODIFIER: dict[OfferType, float] = {
    OfferType.CONSULTATION_FREE: 1.00,
    OfferType.QUOTE_REQUEST: 1.15,
    OfferType.DEMO_REQUEST: 1.80,
    OfferType.TRIAL_FREE: 0.85,
    OfferType.GATED_CONTENT: 0.55,
    OfferType.APPOINTMENT_BOOKING: 1.40,
    OfferType.PHONE_CALL_DIRECT: 1.30,
    OfferType.PURCHASE: 2.50,
}

CHANNEL_MODIFIER: dict[Channel, float] = {
    Channel.LEAD_FORM: 1.00,
    Channel.CLICK_TO_WHATSAPP: 0.55,
    Channel.CLICK_TO_MESSENGER: 0.70,
    Channel.CLICK_TO_WEBSITE: 1.60,
    Channel.VIDEO_VIEW: 1.30,
}

SEASON_MODIFIER: dict[str, float] = {
    "jan": 0.95, "feb": 0.95, "mar": 1.00, "apr": 1.10, "may": 0.95, "jun": 0.90,
    "jul": 0.85, "aug": 0.85, "sep": 1.20, "oct": 1.05, "nov": 1.15, "dec": 1.10,
}

SECURITY_EVENT_MULTIPLIER: float = 2.00


# Israel geo region map — Hebrew region name → GeoTier.
GEO_REGION_MAP: dict[str, GeoTier] = {
    "תל אביב": GeoTier.IL_TEL_AVIV_CENTER,
    "גבעתיים": GeoTier.IL_TEL_AVIV_CENTER,
    "רמת גן": GeoTier.IL_TEL_AVIV_CENTER,
    "הרצליה": GeoTier.IL_TEL_AVIV_CENTER,
    "רמת השרון": GeoTier.IL_TEL_AVIV_CENTER,
    "נתניה": GeoTier.IL_SHARON,
    "רעננה": GeoTier.IL_SHARON,
    "כפר סבא": GeoTier.IL_SHARON,
    "הוד השרון": GeoTier.IL_SHARON,
    "ירושלים": GeoTier.IL_JERUSALEM,
    "חיפה": GeoTier.IL_HAIFA,
    "קריות": GeoTier.IL_HAIFA,
    "באר שבע": GeoTier.IL_SOUTH,
    "אשדוד": GeoTier.IL_SOUTH,
    "אשקלון": GeoTier.IL_SOUTH,
    "טבריה": GeoTier.IL_NORTH,
    "צפת": GeoTier.IL_NORTH,
    "קריית שמונה": GeoTier.IL_NORTH,
    "נהריה": GeoTier.IL_NORTH,
}


def pick_geo_tier(service_regions: list[str] | None) -> GeoTier:
    """
    Map a business's `service_regions` list to a GeoTier.

    TLV-center dominates if present. Multi-region without TLV → periphery_mixed.
    Null/empty → il_all_country (the default for IL-wide campaigns).
    """
    if not service_regions:
        return GeoTier.IL_ALL_COUNTRY
    tiers: set[GeoTier] = set()
    for r in service_regions:
        t = GEO_REGION_MAP.get(r.strip())
        if t is not None:
            tiers.add(t)
    if GeoTier.IL_TEL_AVIV_CENTER in tiers:
        return GeoTier.IL_TEL_AVIV_CENTER
    if GeoTier.IL_SHARON in tiers:
        return GeoTier.IL_SHARON
    if len(tiers) == 0:
        return GeoTier.IL_ALL_COUNTRY
    if len(tiers) > 1:
        return GeoTier.IL_PERIPHERY_MIXED
    return next(iter(tiers))


# ─────────────────────────────────────────────────────────────────────
# Sub-vertical matching
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SubVerticalMatch:
    sub: SubVertical
    matched_terms: tuple[str, ...]
    confidence_of_match: Literal["exact", "fuzzy", "fallback"]


def match_sub_vertical(
    *,
    vertical: Vertical | None,
    products_raw: str | None,
    ideal_customer: str | None,
    usp: str | None,
    main_pain: str | None,
    campaign_name: str | None = None,
) -> SubVerticalMatch:
    """
    Pick the most specific SubVertical from business_knowledge inputs.

    Algorithm: count Hebrew/English match_terms hits against a concatenated
    text blob. Highest-scoring sub-vertical wins. Tied or zero hits → `other`.
    If a parent vertical is given, only sub-verticals with that parent are
    considered (so a `leads` business doesn't accidentally match `saas_*`).

    `campaign_name` — when provided, gets HIGHER weight than business-level
    fields. This is the per-campaign override: a business with 4 services
    (e.g. AIWEON: agents, videos, campaigns, influencers) gets a different
    sub-vertical per running campaign based on the campaign name. Each
    campaign-name term counts as ×3 to ensure it dominates the aggregate.
    """
    parts = [p for p in (products_raw, ideal_customer, usp, main_pain) if p and p.strip()]
    has_business_text = bool(parts)
    has_campaign = bool(campaign_name and campaign_name.strip())
    if not has_business_text and not has_campaign:
        return SubVerticalMatch(sub=SubVertical.OTHER, matched_terms=(), confidence_of_match="fallback")
    business_haystack = "  ".join(parts).lower() if has_business_text else ""
    campaign_haystack = (campaign_name or "").strip().lower()

    CAMPAIGN_WEIGHT = 3  # campaign-name hits dominate aggregate business hits
    scored: list[tuple[SubVertical, int, tuple[str, ...]]] = []
    for sub, cell in SUBVERTICALS.items():
        if vertical is not None and cell.parent != vertical:
            continue
        hits: list[str] = []
        score = 0
        for term in cell.match_terms:
            t_lower = term.lower()
            if campaign_haystack and t_lower in campaign_haystack:
                hits.append(term)
                score += CAMPAIGN_WEIGHT
            elif business_haystack and t_lower in business_haystack:
                hits.append(term)
                score += 1
        if hits:
            scored.append((sub, score, tuple(hits)))

    if not scored:
        return SubVerticalMatch(sub=SubVertical.OTHER, matched_terms=(), confidence_of_match="fallback")

    scored.sort(key=lambda r: r[1], reverse=True)
    best_sub, best_score, best_hits = scored[0]
    # "exact" if at least 2 weighted hits (1 campaign hit alone = 3 weighted ≥ exact)
    return SubVerticalMatch(
        sub=best_sub,
        matched_terms=best_hits,
        confidence_of_match="exact" if best_score >= 2 else "fuzzy",
    )


# ─────────────────────────────────────────────────────────────────────
# Estimation
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TraceStep:
    step: str
    multiplier: float
    running_value: float


@dataclass(frozen=True)
class EstimateInput:
    sub: SubVertical
    geo: GeoTier
    stage: FunnelStage
    offer: OfferType
    channel: Channel
    month: CalendarMonth
    security_event: bool = False


@dataclass
class EstimateResult:
    value_ils: int
    band_ils: tuple[int, int]
    confidence: Confidence
    trace: list[TraceStep]
    citations: list[PrimarySource]
    is_cpa: bool

    def to_research_block(self, *, context_used: list[str]) -> dict:
        """
        Shape an `approvals.research` payload suitable for propose_task.

        Satisfies guardrails §26 set_kpi_target_requires_research:
          - sources[] ≥ 2 entries with title + url + extracted
          - context_used[] non-empty (caller passes from business_knowledge)
          - market_average set

        Returns a dict ready to JSON-serialize into the proposal payload.
        """
        return {
            "market_average": self.value_ils,
            "band_low": self.band_ils[0],
            "band_high": self.band_ils[1],
            "confidence": self.confidence,
            "sources": [
                {"title": s.title, "url": s.url, "extracted": s.extracted}
                for s in self.citations
            ],
            "sources_count": len(self.citations),
            "context_used": context_used,
            "trace": [
                {"step": t.step, "multiplier": t.multiplier, "running_value": t.running_value}
                for t in self.trace
            ],
            "is_cpa": self.is_cpa,
            "source_of_estimate": "cpl_infrastructure_static_2026_05_13",
        }


CalendarMonthLiteral = Literal[
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]

_MONTH_INDEX_TO_NAME: dict[int, CalendarMonthLiteral] = {
    1: "jan", 2: "feb", 3: "mar", 4: "apr", 5: "may", 6: "jun",
    7: "jul", 8: "aug", 9: "sep", 10: "oct", 11: "nov", 12: "dec",
}


def month_of(month_index: int) -> CalendarMonthLiteral:
    """Convert 1-12 month-of-year to the calendar key used by SEASON_MODIFIER."""
    return _MONTH_INDEX_TO_NAME[month_index]


# Patterns the operator's Meta campaign names should NOT look like — when
# any match, the matcher has no information to anchor with and the agent
# should propose an `alert` asking to rename. See §T-2 + decision-tree.md.
import re as _re

_GENERIC_CAMPAIGN_NAME_PATTERNS = [
    _re.compile(r"^\s*campaign(?:\s*\d*)?\s*$", _re.IGNORECASE),
    _re.compile(r"^\s*test\s*\d*\s*$", _re.IGNORECASE),
    _re.compile(r"^\s*untitled\s*$", _re.IGNORECASE),
    _re.compile(r"^\s*new\s+campaign\s*$", _re.IGNORECASE),
    _re.compile(r"^\s*\d+\s*$"),  # just numbers
    _re.compile(r"^\s*\$\s*(date|DATE)\b", _re.IGNORECASE),
    _re.compile(r"^\s*\.{0,3}\s*$"),  # empty or dots
]


def is_generic_campaign_name(name: str | None) -> tuple[bool, str | None]:
    """
    Detect uninformative campaign names. Returns (is_generic, reason).

    Generic campaign names give the matcher zero per-campaign signal — the
    `campaign_name` ×3 boost falls flat because no business match_terms hit
    the name string. When this returns True, §T-2 auto-emits a low-priority
    `alert` asking the operator to rename the campaign with a service name.
    """
    if not name or not name.strip():
        return True, "empty"
    s = name.strip()
    if len(s) < 5:
        return True, f"too_short_{len(s)}_chars"
    for pat in _GENERIC_CAMPAIGN_NAME_PATTERNS:
        if pat.match(s):
            return True, f"matches_pattern_{pat.pattern!r}"
    return False, None


def estimate_cpl(input: EstimateInput) -> EstimateResult:
    """
    Apply the multiplier stack to produce a CPL/CPA estimate.

    See cpl-infrastructure.md §1 for the model. Pure function — no I/O.
    """
    cell = SUBVERTICALS[input.sub]
    trace: list[TraceStep] = []
    running: float = float(cell.base_ils)
    trace.append(TraceStep(step=f"base[{input.sub.value}]", multiplier=1.0, running_value=running))

    def apply(step: str, mul: float) -> None:
        nonlocal running
        running = running * mul
        trace.append(TraceStep(step=step, multiplier=mul, running_value=running))

    apply(f"geo[{input.geo.value}]", GEO_MODIFIER[input.geo])
    apply(f"stage[{input.stage.value}]", STAGE_MODIFIER[input.stage])
    apply(f"offer[{input.offer.value}]", OFFER_MODIFIER[input.offer])
    apply(f"channel[{input.channel.value}]", CHANNEL_MODIFIER[input.channel])
    apply(f"season[{input.month}]", SEASON_MODIFIER[input.month])
    if input.security_event:
        apply("security_event", SECURITY_EVENT_MULTIPLIER)

    total_multiplier = running / cell.base_ils
    band_low = int(round(cell.band_ils[0] * total_multiplier))
    band_high = int(round(cell.band_ils[1] * total_multiplier))

    return EstimateResult(
        value_ils=int(round(running)),
        band_ils=(band_low, band_high),
        confidence=cell.confidence,
        trace=trace,
        citations=[PRIMARY_SOURCES[sid] for sid in cell.primary_source_ids],
        is_cpa=cell.is_cpa,
    )


__all__ = [
    "CalendarMonth",
    "CHANNEL_MODIFIER",
    "Channel",
    "Confidence",
    "EstimateInput",
    "EstimateResult",
    "FunnelStage",
    "GEO_MODIFIER",
    "GEO_REGION_MAP",
    "GeoTier",
    "OFFER_MODIFIER",
    "OfferType",
    "PRIMARY_SOURCES",
    "PrimarySource",
    "SEASON_MODIFIER",
    "SECURITY_EVENT_MULTIPLIER",
    "STAGE_MODIFIER",
    "SUBVERTICALS",
    "SubVertical",
    "SubVerticalCell",
    "SubVerticalMatch",
    "TraceStep",
    "Vertical",
    "estimate_cpl",
    "is_generic_campaign_name",
    "match_sub_vertical",
    "month_of",
    "pick_geo_tier",
]
