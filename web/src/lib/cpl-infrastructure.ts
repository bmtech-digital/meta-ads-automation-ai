/**
 * CPL Infrastructure — Israel 2026 (Multi-Dimensional)
 *
 * Typed mirror of `campaigner/prompts/cpl-infrastructure.md`. Numeric values
 * MUST agree. Edit both files in the same commit.
 *
 * The agent reads the .md file at runtime; the UI reads this file to render
 * the same band on the dashboard and in /business-knowledge. The shared
 * shape lets the operator see the same number the agent will act on.
 *
 * Architecture:
 *
 *   estimated_cpl_ils =
 *       SUBVERTICALS[sub].base_ils
 *     × GEO_MODIFIER[geo]
 *     × STAGE_MODIFIER[stage]
 *     × OFFER_MODIFIER[offer]
 *     × CHANNEL_MODIFIER[channel]
 *     × SEASON_MODIFIER[month]
 *     × (security_event ? SECURITY_EVENT_MULTIPLIER : 1.0)
 *
 * See cpl-infrastructure.md §1-§9 for rationale and primary sources.
 *
 * Supersedes the flat per-vertical bands in `kpi-benchmarks.ts` for any
 * caller that can supply sub-vertical + context. The flat file remains as
 * a fallback for legacy `getBenchmark(vertical, kpi)` callers.
 */

import type { Vertical } from "./db/types";

// ────────────────────────────────────────────────────────────────────
// Sub-verticals
// ────────────────────────────────────────────────────────────────────

export type SubVertical =
  // leads (B2C services)
  | "real_estate_residential"
  | "real_estate_commercial"
  | "home_services"
  | "renovation_contractor"
  | "insurance_agent"
  | "automotive_dealer"
  | "automotive_service"
  | "beauty_aesthetic"
  | "wellness_alt"
  | "fitness_studio"
  | "dental_clinic"
  | "private_clinic"
  | "legal_personal"
  | "legal_corporate"
  | "accounting_tax"
  | "education_private"
  | "education_university"
  // b2b_saas
  | "saas_horizontal"
  | "saas_marketing_tech"
  | "saas_dev_tech"
  | "agency_services"
  // AIWEON-style productized AI services — added 2026-05-13
  | "ai_chatbot_services"
  | "ai_video_production"
  | "ai_campaign_management"
  // ecommerce (CPA, not CPL)
  | "ecom_fashion"
  | "ecom_beauty_products"
  | "ecom_electronics"
  | "ecom_home_goods"
  | "ecom_food_supplements"
  // unmapped
  | "other";

export type Confidence = "high" | "medium" | "low";

export interface SubVerticalCell {
  /** Parent vertical this belongs to (matches Vertical enum). */
  parent: Vertical;
  /** Israel-default, cold lead-form, consultation, normal month — ILS. */
  base_ils: number;
  /** 25th-75th percentile band — ILS. */
  band_ils: [number, number];
  confidence: Confidence;
  /** Hebrew+English match terms used to route business_knowledge → sub_vertical. */
  match_terms: string[];
  /** For ecommerce sub-verticals: this is base_CPA_ils, not CPL. */
  is_cpa?: true;
  /** Reference IDs in PRIMARY_SOURCES below — these are the citable sources. */
  primary_sources: PrimarySourceId[];
}

export const SUBVERTICALS: Record<SubVertical, SubVerticalCell> = {
  // ─── leads ───
  real_estate_residential: {
    parent: "leads",
    base_ils: 280,
    band_ils: [180, 450],
    confidence: "medium",
    match_terms: ["נדל\"ן מגורים", "דירה", "מתווך", "מתווכת", "יזם דירות", "real estate"],
    primary_sources: ["adamigo-cpl-industry-2026", "stape-realestate-2026"],
  },
  real_estate_commercial: {
    parent: "leads",
    base_ils: 550,
    band_ils: [350, 900],
    confidence: "low",
    match_terms: ["נדל\"ן מסחרי", "משרדים להשכרה", "נכס מסחרי", "commercial real estate"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  home_services: {
    parent: "leads",
    base_ils: 120,
    band_ils: [70, 200],
    confidence: "high",
    match_terms: [
      "אינסטלטור", "חשמלאי", "מזגנים", "מנעולן", "פורץ דלתות", "ניקיון בית",
      "plumber", "electrician", "HVAC", "locksmith",
    ],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  renovation_contractor: {
    parent: "leads",
    base_ils: 180,
    band_ils: [100, 320],
    confidence: "medium",
    match_terms: ["קבלן שיפוצים", "שיפוצים", "ריצוף", "גבס", "צבעי", "renovation", "contractor"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  insurance_agent: {
    parent: "leads",
    base_ils: 240,
    band_ils: [130, 400],
    confidence: "medium",
    match_terms: [
      "סוכן ביטוח", "ביטוח חיים", "ביטוח רכב", "ביטוח בריאות", "פנסיה",
      "insurance",
    ],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  automotive_dealer: {
    parent: "leads",
    base_ils: 200,
    band_ils: [110, 340],
    confidence: "medium",
    match_terms: ["סוכנות רכב", "רכבים חדשים", "רכב יד שנייה", "car dealer"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  automotive_service: {
    parent: "leads",
    base_ils: 75,
    band_ils: [40, 140],
    confidence: "medium",
    match_terms: ["מוסך", "חשמלאי רכב", "פנצ'רייה", "חלפים", "auto service"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  beauty_aesthetic: {
    parent: "leads",
    base_ils: 130,
    band_ils: [70, 230],
    confidence: "high",
    match_terms: [
      "בוטוקס", "חומצה היאלורונית", "הסרת שיער בלייזר", "אסתטיקה", "רפואה אסתטית",
      "botox", "filler", "laser hair", "aesthetic",
    ],
    primary_sources: ["adamigo-cpl-industry-2026", "webfx-healthcare-2026"],
  },
  wellness_alt: {
    parent: "leads",
    base_ils: 80,
    band_ils: [40, 160],
    confidence: "medium",
    match_terms: ["רפלקסולוגיה", "שיאצו", "רפואה משלימה", "יוגה תרפיה", "מיינדפולנס"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  fitness_studio: {
    parent: "leads",
    base_ils: 75,
    band_ils: [35, 150],
    confidence: "high",
    match_terms: [
      "חדר כושר", "פילאטיס", "קרוספיט", "סטודיו", "אימון אישי",
      "gym", "crossfit", "pilates",
    ],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  dental_clinic: {
    parent: "leads",
    base_ils: 150,
    band_ils: [80, 280],
    confidence: "medium",
    match_terms: ["רופא שיניים", "מרפאת שיניים", "יישור שיניים", "השתלות שיניים", "dental"],
    primary_sources: ["adamigo-cpl-industry-2026", "webfx-healthcare-2026"],
  },
  private_clinic: {
    parent: "leads",
    base_ils: 200,
    band_ils: [100, 380],
    confidence: "low",
    match_terms: ["רופא פרטי", "מרפאה פרטית", "רופא משפחה", "רופא מומחה"],
    primary_sources: ["webfx-healthcare-2026"],
  },
  legal_personal: {
    parent: "leads",
    base_ils: 380,
    band_ils: [200, 700],
    confidence: "medium",
    match_terms: ["עורך דין", "גירושין", "פלילי", "נזיקין", "תאונות דרכים", "lawyer", "attorney"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  legal_corporate: {
    parent: "leads",
    base_ils: 700,
    band_ils: [400, 1300],
    confidence: "low",
    match_terms: ["עו\"ד מסחרי", "חברות", "הסכמים", "נדל\"ן עו\"ד", "corporate law"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  accounting_tax: {
    parent: "leads",
    base_ils: 250,
    band_ils: [140, 450],
    confidence: "medium",
    match_terms: ["רואה חשבון", "יועץ מס", "הנהלת חשבונות", "הקמת חברה", "accounting"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  education_private: {
    parent: "leads",
    base_ils: 110,
    band_ils: [50, 200],
    confidence: "medium",
    match_terms: ["מורה פרטי", "שיעורי עזר", "פסיכומטרי", "קורסים פרטיים", "tutor"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },
  education_university: {
    parent: "leads",
    base_ils: 180,
    band_ils: [90, 340],
    confidence: "medium",
    match_terms: ["תואר ראשון", "MBA", "מכללה", "אוניברסיטה", "לימודי המשך", "degree", "university"],
    primary_sources: ["adamigo-cpl-industry-2026"],
  },

  // ─── b2b_saas ───
  saas_horizontal: {
    parent: "b2b_saas",
    base_ils: 320,
    band_ils: [180, 600],
    confidence: "medium",
    match_terms: ["SaaS", "platform", "dashboard"],
    primary_sources: ["aimers-saas-2026", "growthspree-saas-2026"],
  },
  saas_marketing_tech: {
    parent: "b2b_saas",
    base_ils: 420,
    band_ils: [250, 800],
    confidence: "high",
    match_terms: [
      "analytics", "ad tech", "influencer marketing", "marketing platform",
      "מערכת שיווק", "פלטפורמת שיווק", "פלטפורמת משפיענים",
      "משפיעות", "משפיענים", "influencer", "creator marketing",
      "מיתוג משפיעות", "influencer branding",
    ],
    primary_sources: ["aimers-saas-2026", "growthspree-saas-2026", "manus-il-cpl-2026"],
  },
  saas_dev_tech: {
    parent: "b2b_saas",
    base_ils: 500,
    band_ils: [300, 950],
    confidence: "low",
    match_terms: ["DevTools", "API", "infrastructure", "observability"],
    primary_sources: ["aimers-saas-2026"],
  },
  agency_services: {
    parent: "b2b_saas",
    base_ils: 280,
    band_ils: [160, 520],
    confidence: "medium",
    match_terms: ["סוכנות שיווק", "סוכנות פרסום", "סוכנות דיגיטל", "agency"],
    primary_sources: ["aimers-saas-2026"],
  },
  // ─── AIWEON-style productized AI services (added 2026-05-13) ───
  // Each has a dedicated band derived from B2B-SaaS demo-CPL data
  // (Aimers $40-65 standard, GrowthSpree $150-400 demos), adjusted for IL
  // premium (×2-2.5) and per-service friction. Confidence=medium until
  // live WebSearch refinement per cell. Operator can run per-service
  // research via "חקור שירות זה" on /business-knowledge.
  ai_chatbot_services: {
    parent: "b2b_saas",
    base_ils: 480, // demo-required, high-friction enterprise sale
    band_ils: [280, 900],
    confidence: "medium",
    match_terms: [
      "סוכני AI", "סוכן AI", "AI agent", "AI agents", "chatbot",
      "AI chatbot", "צ'אט AI", "צאט בוט", "voice agent", "voice AI",
      "AI sales agent", "סוכן מכירות AI", "conversational AI",
    ],
    primary_sources: [
      "aimers-saas-2026",
      "growthspree-saas-2026",
      "manus-il-cpl-2026",
    ],
  },
  ai_video_production: {
    parent: "b2b_saas",
    base_ils: 380, // mid-friction; AOV ₪4500-18000 per video drives serious buyers
    band_ils: [220, 720],
    confidence: "medium",
    match_terms: [
      "סרטוני AI", "סרטון AI", "AI video", "AI videos", "video AI",
      "AI video production", "video branding", "voice cloning",
      "סרטוני שיווק AI", "הפקת סרטוני AI",
    ],
    primary_sources: ["aimers-saas-2026", "manus-il-cpl-2026"],
  },
  ai_campaign_management: {
    parent: "b2b_saas",
    base_ils: 520, // highest friction — ongoing retainer, ≥₪15k/mo commitment
    band_ils: [300, 1000],
    confidence: "medium",
    match_terms: [
      "קמפיינים AI", "קמפיין AI", "AI campaigner", "AI campaigns",
      "managed ads AI", "ניהול קמפיינים AI", "AI ad management",
      "performance marketing AI",
    ],
    primary_sources: [
      "aimers-saas-2026",
      "growthspree-saas-2026",
      "adamigo-country-2026",
    ],
  },

  // ─── ecommerce (CPA, not CPL) ───
  ecom_fashion: {
    parent: "ecommerce",
    base_ils: 55,
    band_ils: [30, 110],
    confidence: "high",
    is_cpa: true,
    match_terms: ["אופנה", "בגדים", "שמלות", "גרבי גוף", "fashion", "clothing"],
    primary_sources: ["wordstream-fb-2025"],
  },
  ecom_beauty_products: {
    parent: "ecommerce",
    base_ils: 60,
    band_ils: [35, 120],
    confidence: "high",
    is_cpa: true,
    match_terms: ["טיפוח", "איפור", "פנים", "שיער", "מוצרי קוסמטיקה", "cosmetics", "skincare"],
    primary_sources: ["wordstream-fb-2025"],
  },
  ecom_electronics: {
    parent: "ecommerce",
    base_ils: 75,
    band_ils: [40, 170],
    confidence: "medium",
    is_cpa: true,
    match_terms: ["אלקטרוניקה", "גאדג'טים", "מסכים", "אוזניות", "electronics"],
    primary_sources: ["wordstream-fb-2025"],
  },
  ecom_home_goods: {
    parent: "ecommerce",
    base_ils: 70,
    band_ils: [35, 140],
    confidence: "medium",
    is_cpa: true,
    match_terms: ["מטבח", "רהיטים", "כריות", "מצעים", "עיצוב הבית", "home goods"],
    primary_sources: ["wordstream-fb-2025"],
  },
  ecom_food_supplements: {
    parent: "ecommerce",
    base_ils: 50,
    band_ils: [25, 110],
    confidence: "medium",
    is_cpa: true,
    match_terms: ["תוספי תזונה", "ויטמינים", "חלבון", "מזון בריאות", "supplements"],
    primary_sources: ["wordstream-fb-2025"],
  },

  // ─── unmapped ───
  other: {
    parent: "other",
    base_ils: 200,
    band_ils: [100, 400],
    confidence: "low",
    match_terms: [],
    primary_sources: [],
  },
};

// ────────────────────────────────────────────────────────────────────
// Geographic tier modifier
// ────────────────────────────────────────────────────────────────────

export type GeoTier =
  | "il_tel_aviv_center"
  | "il_sharon"
  | "il_jerusalem"
  | "il_haifa"
  | "il_south"
  | "il_north"
  | "il_periphery_mixed"
  | "il_all_country"
  | "global";

export const GEO_MODIFIER: Record<GeoTier, number> = {
  il_tel_aviv_center: 1.30,
  il_sharon: 1.15,
  il_jerusalem: 1.05,
  il_haifa: 1.05,
  il_south: 0.85,
  il_north: 0.80,
  il_periphery_mixed: 0.90,
  il_all_country: 1.0,
  global: 0.7,
};

const GEO_REGION_MAP: Record<string, GeoTier> = {
  "תל אביב": "il_tel_aviv_center",
  "גבעתיים": "il_tel_aviv_center",
  "רמת גן": "il_tel_aviv_center",
  "הרצליה": "il_tel_aviv_center",
  "רמת השרון": "il_tel_aviv_center",
  "נתניה": "il_sharon",
  "רעננה": "il_sharon",
  "כפר סבא": "il_sharon",
  "הוד השרון": "il_sharon",
  "ירושלים": "il_jerusalem",
  "חיפה": "il_haifa",
  "קריות": "il_haifa",
  "באר שבע": "il_south",
  "אשדוד": "il_south",
  "אשקלון": "il_south",
  "טבריה": "il_north",
  "צפת": "il_north",
  "קריית שמונה": "il_north",
  "נהריה": "il_north",
};

export function pickGeoTier(serviceRegions: string[] | null): GeoTier {
  if (!serviceRegions || serviceRegions.length === 0) return "il_all_country";
  // If any region is in TLV-center group, that dominates.
  const tiers = new Set(
    serviceRegions
      .map((r) => GEO_REGION_MAP[r.trim()])
      .filter((t): t is GeoTier => t !== undefined),
  );
  if (tiers.has("il_tel_aviv_center")) return "il_tel_aviv_center";
  if (tiers.has("il_sharon")) return "il_sharon";
  if (tiers.size === 0) return "il_all_country";
  // Multi-region but not TLV → average via periphery_mixed.
  if (tiers.size > 1) return "il_periphery_mixed";
  // Single tier match.
  return [...tiers][0];
}

// ────────────────────────────────────────────────────────────────────
// Funnel-stage modifier
// ────────────────────────────────────────────────────────────────────

export type FunnelStage =
  | "cold"
  | "warm_engagement"
  | "warm_visit"
  | "lookalike_customers"
  | "retargeting_form_opener";

export const STAGE_MODIFIER: Record<FunnelStage, number> = {
  cold: 1.0,
  warm_engagement: 0.5,
  warm_visit: 0.35,
  lookalike_customers: 0.65,
  retargeting_form_opener: 0.25,
};

// ────────────────────────────────────────────────────────────────────
// Offer-type modifier
// ────────────────────────────────────────────────────────────────────

export type OfferType =
  | "consultation_free"
  | "quote_request"
  | "demo_request"
  | "trial_free"
  | "gated_content"
  | "appointment_booking"
  | "phone_call_direct"
  | "purchase";

export const OFFER_MODIFIER: Record<OfferType, number> = {
  consultation_free: 1.0,
  quote_request: 1.15,
  demo_request: 1.8,
  trial_free: 0.85,
  gated_content: 0.55,
  appointment_booking: 1.4,
  phone_call_direct: 1.3,
  purchase: 2.5,
};

// ────────────────────────────────────────────────────────────────────
// Channel modifier
// ────────────────────────────────────────────────────────────────────

export type Channel =
  | "lead_form"
  | "click_to_whatsapp"
  | "click_to_messenger"
  | "click_to_website"
  | "video_view";

export const CHANNEL_MODIFIER: Record<Channel, number> = {
  lead_form: 1.0,
  click_to_whatsapp: 0.55,
  click_to_messenger: 0.7,
  click_to_website: 1.6,
  video_view: 1.3,
};

// ────────────────────────────────────────────────────────────────────
// Seasonality modifier (Israel calendar)
// ────────────────────────────────────────────────────────────────────

export type CalendarMonth =
  | "jan" | "feb" | "mar" | "apr" | "may" | "jun"
  | "jul" | "aug" | "sep" | "oct" | "nov" | "dec";

export const SEASON_MODIFIER: Record<CalendarMonth, number> = {
  jan: 0.95,
  feb: 0.95,
  mar: 1.0,
  apr: 1.1, // Pesach
  may: 0.95,
  jun: 0.9,
  jul: 0.85,
  aug: 0.85,
  sep: 1.2, // Tishrei peak
  oct: 1.05,
  nov: 1.15, // peak month — Black Friday + pre-Hanukkah
  dec: 1.1,
};

/** Wartime / active conflict multiplier — manual flag on business_settings. */
export const SECURITY_EVENT_MULTIPLIER = 2.0;

export function monthOf(date: Date): CalendarMonth {
  const months: CalendarMonth[] = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  return months[date.getMonth()];
}

// ────────────────────────────────────────────────────────────────────
// Primary sources (citable for research.sources[])
// ────────────────────────────────────────────────────────────────────

export type PrimarySourceId =
  | "adamigo-cpl-industry-2026"
  | "adamigo-country-2026"
  | "adamigo-leadform-vs-lp"
  | "egrow-ctwa-2026"
  | "forrester-ctwa-meta"
  | "stape-realestate-2026"
  | "stackmatix-funnel-2026"
  | "aimers-saas-2026"
  | "growthspree-saas-2026"
  | "webfx-healthcare-2026"
  | "wordstream-fb-2025"
  | "manus-il-cpl-2026"
  | "grok-il-2026";

export interface PrimarySource {
  title: string;
  url: string;
  extracted: string;
}

export const PRIMARY_SOURCES: Record<PrimarySourceId, PrimarySource> = {
  "adamigo-cpl-industry-2026": {
    title: "AdAmigo Meta Ads CPL Benchmarks by Industry 2026",
    url: "https://www.adamigo.ai/blog/meta-ads-cost-per-lead-benchmarks-industry-2026",
    extracted:
      "Real Estate $51.90 average CPL (Tier 1 cities $35-$65); Home Services $34.00; Healthcare $41.60; B2B SaaS $63.40 (qualified $150-$250); Legal Services $72.40",
  },
  "adamigo-country-2026": {
    title: "AdAmigo Meta Ads CPM/CPC by Country 2026",
    url: "https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026",
    extracted:
      "Israel is Tier 2; CPM Dec'24 $6.49 → Dec'25 $8.72 (+34% YoY); peak Nov $10.74, low Jun $4.85; monthly volatility 2.21 vs global 1.28",
  },
  "adamigo-leadform-vs-lp": {
    title: "AdAmigo Lead Form vs Landing Page Benchmarks 2026",
    url: "https://www.adamigo.ai/blog/meta-lead-form-vs-landing-page-benchmarks-by-industry-2026",
    extracted:
      "Meta Lead Forms see CPLs 40-70% lower than landing pages; Instant Forms reduce fill time from 2 min to 20 sec",
  },
  "egrow-ctwa-2026": {
    title: "Egrow Click-to-WhatsApp Ads Complete Guide 2026",
    url: "https://www.egrow.com/en/blog/click-to-whatsapp-ads-the-complete-guide-to-driving-sales-from-meta-to-whatsapp-2026",
    extracted:
      "Click-to-WhatsApp typical CPL $1-5 vs landing pages $5-25; per-acquisition $3-15 emerging markets, $15-50 developed",
  },
  "forrester-ctwa-meta": {
    title: "Forrester Consulting (Meta-commissioned) CTWA study",
    url: "https://www.egrow.com/en/blog/click-to-whatsapp-ads-the-complete-guide-to-driving-sales-from-meta-to-whatsapp-2026",
    extracted:
      "94% conversion rate lift, 92% drop in cost per lead for Click-to-WhatsApp Ads vs landing pages (treat as upper-bound; conservative practitioners use 40-50% off)",
  },
  "stape-realestate-2026": {
    title: "Stape Real Estate Facebook Ads Guide 2026",
    url: "https://stape.io/blog/real-estate-facebook-ads",
    extracted:
      "Retargeting warm audiences delivers 3-5× lower CPL than cold prospecting; 92% of real estate agents use Facebook",
  },
  "stackmatix-funnel-2026": {
    title: "Stackmatix Meta Ads Funnel Strategy 2026",
    url: "https://www.stackmatix.com/blog/meta-ads-funnel-strategy",
    extracted:
      "20-30% of total Meta budget on TOFU campaigns; warm retargeting delivers significantly lower CPL",
  },
  "aimers-saas-2026": {
    title: "Aimers Facebook Ads Cost for SaaS 2026",
    url: "https://aimers.io/blog/facebook-ads-cost",
    extracted:
      "Facebook Ads in SaaS work in $40-65 CPL range for standard B2B leads; qualified leads cost $150+ for MQL/SQL level",
  },
  "growthspree-saas-2026": {
    title: "GrowthSpree B2B SaaS Demo Request Conversion Benchmarks 2026",
    url: "https://www.growthspreeofficial.com/blogs/b2b-saas-demo-request-conversion-rate-benchmarks-2026",
    extracted:
      "Demo request CPLs $150-400 across paid channels; CVR drops from 8.2% to 6.4% with form friction",
  },
  "webfx-healthcare-2026": {
    title: "WebFX Healthcare Marketing Benchmarks 2026",
    url: "https://www.webfx.com/blog/healthcare/marketing-benchmarks-for-healthcare/",
    extracted:
      "Healthcare leads average $377 (B2B) and $367 (B2C); B2C wellness CPLs range $98-$661 depending on service",
  },
  "wordstream-fb-2025": {
    title: "WordStream Facebook Ads Benchmarks 2025",
    url: "https://www.wordstream.com/blog/facebook-ads-benchmarks-2025",
    extracted:
      "Facebook lead ads CVR 7.72%, global average CPL $27.66",
  },
  "manus-il-cpl-2026": {
    title: "Manus deep research (internal) — Israel Meta Ads CPL 2026",
    url: "docs/deep_research/manus-meta-evaluation-andromeda-2026-04-16.md",
    extracted:
      "Israel CPL $104.72 (~2.5× global $41.53); wartime spikes documented up to $385 (~₪1,400)",
  },
  "grok-il-2026": {
    title: "Grok deep research (internal) — Israel Meta Ads benchmarks 2026",
    url: "docs/deep_research/grok-meta-evaluation-andromeda-2026-04-15.md",
    extracted:
      "Israel CPM low (Tier 2) but CPL elevated due to small audience density and high advertiser saturation per Hebrew-speaking pool",
  },
};

// ────────────────────────────────────────────────────────────────────
// Sub-vertical match — business_knowledge → SubVertical
// ────────────────────────────────────────────────────────────────────

interface MatchInput {
  vertical: Vertical | null;
  products_raw: string | null;
  ideal_customer: string | null;
  usp: string | null;
  main_pain: string | null;
  /**
   * Per-campaign override. When set, the campaign name is folded into the
   * matcher haystack at ×3 weight so a multi-product business (e.g. AIWEON's
   * agents + videos + campaigns + influencers) gets the sub-vertical of
   * THIS campaign, not the aggregate dominant one.
   */
  campaign_name?: string | null;
}

/**
 * Same input as `matchSubVertical`, but returns the top N candidates with
 * their hit counts and matched terms. Use this when transparency matters
 * — e.g. on /business-knowledge to show the operator everything the matcher
 * considered, not just the winner.
 */
export function rankSubVerticals(
  input: MatchInput,
  limit = 5,
): Array<{ sub: SubVertical; score: number; matched_terms: string[] }> {
  const businessHaystack = [
    input.products_raw,
    input.ideal_customer,
    input.usp,
    input.main_pain,
  ]
    .filter((s): s is string => s !== null && s.trim().length > 0)
    .join("  ")
    .toLowerCase();
  const campaignHaystack = (input.campaign_name ?? "").trim().toLowerCase();
  if (businessHaystack.length === 0 && campaignHaystack.length === 0) return [];
  const CAMPAIGN_WEIGHT = 3;

  const ranked: Array<{ sub: SubVertical; score: number; matched_terms: string[] }> = [];
  for (const [sub, cell] of Object.entries(SUBVERTICALS) as Array<
    [SubVertical, SubVerticalCell]
  >) {
    if (input.vertical !== null && cell.parent !== input.vertical) continue;
    const hits: string[] = [];
    let score = 0;
    for (const term of cell.match_terms) {
      const tLower = term.toLowerCase();
      if (campaignHaystack && campaignHaystack.includes(tLower)) {
        hits.push(term);
        score += CAMPAIGN_WEIGHT;
      } else if (businessHaystack && businessHaystack.includes(tLower)) {
        hits.push(term);
        score += 1;
      }
    }
    if (hits.length > 0) {
      ranked.push({ sub, score, matched_terms: hits });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

export function matchSubVertical(input: MatchInput): {
  sub: SubVertical;
  matched_terms: string[];
  confidence_of_match: "exact" | "fuzzy" | "fallback";
} {
  const ranked = rankSubVerticals(input, 1);
  if (ranked.length === 0) {
    return {
      sub: "other",
      matched_terms: [],
      confidence_of_match: "fallback",
    };
  }
  const top = ranked[0];
  return {
    sub: top.sub,
    matched_terms: top.matched_terms,
    confidence_of_match: top.score >= 2 ? "exact" : "fuzzy",
  };
}

// ────────────────────────────────────────────────────────────────────
// Main estimation entry point
// ────────────────────────────────────────────────────────────────────

export interface EstimateInput {
  sub: SubVertical;
  geo: GeoTier;
  stage: FunnelStage;
  offer: OfferType;
  channel: Channel;
  month: CalendarMonth;
  security_event: boolean;
}

export interface EstimateResult {
  /** Computed CPL (or CPA for ecommerce sub-verticals) in ILS, rounded. */
  value_ils: number;
  /** Realistic band — computed from sub-vertical band × all modifiers. */
  band_ils: [number, number];
  /** Aggregate confidence: min of sub-vertical confidence and "high" floor. */
  confidence: Confidence;
  /** Step-by-step trace of multipliers — for explaining to the operator. */
  trace: Array<{ step: string; multiplier: number; running_value: number }>;
  /** Pre-extracted source citations — feed straight into research.sources[]. */
  citations: PrimarySource[];
  /** Whether result is CPA (ecommerce) instead of CPL. */
  is_cpa: boolean;
}

export function estimateCPL(input: EstimateInput): EstimateResult {
  const cell = SUBVERTICALS[input.sub];
  const trace: EstimateResult["trace"] = [];
  let running = cell.base_ils;
  trace.push({
    step: `base[${input.sub}]`,
    multiplier: 1,
    running_value: running,
  });

  const apply = (step: string, mul: number) => {
    running = running * mul;
    trace.push({ step, multiplier: mul, running_value: running });
  };

  apply(`geo[${input.geo}]`, GEO_MODIFIER[input.geo]);
  apply(`stage[${input.stage}]`, STAGE_MODIFIER[input.stage]);
  apply(`offer[${input.offer}]`, OFFER_MODIFIER[input.offer]);
  apply(`channel[${input.channel}]`, CHANNEL_MODIFIER[input.channel]);
  apply(`season[${input.month}]`, SEASON_MODIFIER[input.month]);
  if (input.security_event) {
    apply("security_event", SECURITY_EVENT_MULTIPLIER);
  }

  const totalMultiplier = running / cell.base_ils;
  const bandLow = Math.round(cell.band_ils[0] * totalMultiplier);
  const bandHigh = Math.round(cell.band_ils[1] * totalMultiplier);

  return {
    value_ils: Math.round(running),
    band_ils: [bandLow, bandHigh],
    confidence: cell.confidence,
    trace,
    citations: cell.primary_sources.map((id) => PRIMARY_SOURCES[id]),
    is_cpa: cell.is_cpa === true,
  };
}
