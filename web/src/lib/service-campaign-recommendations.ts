/**
 * Service campaign recommendations — what kind of campaign to run for
 * each service, by sub-vertical. Read by the per-service hub on
 * /business-knowledge so the operator has concrete next steps, not just
 * a price band.
 *
 * Per sub-vertical, we recommend:
 *   - objective       — Meta campaign objective (leads / messages / sales / traffic)
 *   - channel         — primary ad format (lead_form / click_to_whatsapp / etc.)
 *   - daily_budget_ils_min — floor for the agent's `(CPL × 50) / 7` Learning-Phase math
 *   - cold_start_advice — Hebrew, operator-facing
 *   - first_campaign_template — the agent uses this as the seed when proposing a `new_campaign`
 *
 * Each entry includes a `rationale` field that documents WHY this objective
 * was picked for the sub-vertical. The agent quotes from rationale when
 * proposing the campaign so the operator sees the logic.
 *
 * Source of recommendations: synthesis of CAMPAIGN_BUILDING_RECOMMENDATIONS.md
 * § Lead-gen → Andromeda 2026 best practices + per-sub-vertical adjustments.
 */

import type { SubVertical } from "./cpl-infrastructure";

export interface ServiceCampaignRecommendation {
  /** Display label in Hebrew — short, operator-friendly. */
  campaign_type_he: string;
  /** Meta campaign objective. */
  objective:
    | "OUTCOME_LEADS"
    | "OUTCOME_ENGAGEMENT"
    | "OUTCOME_SALES"
    | "OUTCOME_TRAFFIC"
    | "OUTCOME_AWARENESS";
  /** Primary ad format / channel. */
  channel:
    | "lead_form"
    | "click_to_whatsapp"
    | "click_to_messenger"
    | "click_to_website"
    | "video_view";
  /** Minimum daily budget (ILS) below which Meta's 50-event Learning rule won't be met. */
  daily_budget_ils_min: number;
  /** Hebrew explanation of why this combo. Used in agent rationale. */
  rationale_he: string;
  /** Operator-facing cold-start advice (first 14 days). */
  cold_start_advice_he: string;
  /** Recommended creative format mix — used to filter gallery items + guide firehose. */
  creative_mix: Array<"video_9_16" | "video_4_5" | "image_1_1" | "image_4_5" | "image_9_16" | "carousel">;
}

/**
 * Defaults — used when the sub-vertical isn't in the per-sub-vertical map below.
 * Mirrors the IL B2C-services baseline (most common operator path).
 */
const DEFAULT_RECOMMENDATION: ServiceCampaignRecommendation = {
  campaign_type_he: "לידים — טופס פנימי או WhatsApp",
  objective: "OUTCOME_LEADS",
  channel: "click_to_whatsapp",
  daily_budget_ils_min: 60,
  rationale_he:
    "ברירת מחדל לעסקי שירותים בישראל. WhatsApp חוסך כ-45% מה-CPL מול דף נחיתה ומביא לידים שכבר מוכנים לדבר. תקציב יומי מינימלי ≥ ₪60 מאפשר ל-Meta להשלים ≥ 50 המרות בתוך 7 ימים — תנאי יציאה מ-Learning.",
  cold_start_advice_he:
    "השאר 14 ימים בלי לגעת. אל תשנה קהל, אל תכבה קריאייטיב — Meta צריכה זמן ללמוד. אחרי 50 המרות מתקבלות החלטות.",
  creative_mix: ["video_9_16", "image_1_1", "image_4_5"],
};

/**
 * Per-sub-vertical recommendations. Entries override the default for
 * AIWEON's productized AI services (where demo-friction + B2B nature
 * change the playbook significantly).
 */
export const SUBVERTICAL_RECOMMENDATIONS: Partial<
  Record<SubVertical, ServiceCampaignRecommendation>
> = {
  // ─── AIWEON's 4 productized services ───
  ai_chatbot_services: {
    campaign_type_he: "דמו ל-B2B — הזמנת שיחה / טופס דמו",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 120, // CPL ₪480 × 50 / 7 ÷ ~2 conversion rate ≈ ₪120 floor
    rationale_he:
      "סוכן AI הוא רכש B2B עם friction גבוה — דורש דמו אנושי ולעיתים קרובות חתימת חוזה. Meta Lead Form ב-Instant Form דומיננטי כאן (לא CTWA — לרכש B2B WhatsApp הוא ערוץ חלש כי החלטה דורשת ועדה פנימית). תקציב יומי ≥ ₪120 כי CPL מצופה ₪280-900 וצריך ≥ 50 לידים ב-7 ימים.",
    cold_start_advice_he:
      "30 הימים הראשונים: לא לחפש CPL נמוך, לחפש איכות. לידים שמגיעים לא יוכשרו אם הקהל גרוע — תן ל-Meta 50 לידים ואז סנן בשיחות מכירה. הוסף Pixel + CAPI לפני שאתה משיק כי בלי המרות-איכות אי אפשר לאמן.",
    creative_mix: ["video_9_16", "video_4_5", "image_1_1"],
  },
  ai_video_production: {
    campaign_type_he: "הצעת מחיר מהירה — קריאייטיב משלך מציג את המוצר",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 100,
    rationale_he:
      "סרטוני AI נמכרים על איכות הסרטון עצמו — הקריאייטיב הוא המוצר. הגישה: סרטון אחד בצורת before/after או דמו של 15 שניות ש-מציג את האיכות. CTWA פחות אפקטיבי כי הקונה רוצה לראות פורטפוליו לפני שהוא מדבר. CPL מצופה ₪220-720 — תקציב יומי ≥ ₪100 פותר את מתמטיקת ה-Learning.",
    cold_start_advice_he:
      "השקיע ב-3 וריאציות קריאייטיב מתחת ל-15 שניות לפני שאתה משיק. אחת מהן חייבת להיות 'דמו של דמו' — סרטון של 7 שניות שמראה דוגמה. נסה לא לטרגט מנהלי שיווק ברמה הראשונית, התחל מבעלי עסקים שמחפשים סרטונים זולים.",
    creative_mix: ["video_9_16", "video_4_5"],
  },
  ai_campaign_management: {
    campaign_type_he: "B2B מתקדם — אבחון חינם של חשבון Meta קיים",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 150,
    rationale_he:
      "ניהול קמפיינים AI הוא retainer של ≥ ₪15k/חודש — קונה רוצה ביטחון לפני שהוא משתף את חשבון Meta שלו. ההצעה: 'אבחון חינם של 60 דקות' = lead form שמייצר שיחות איכותיות. תקציב יומי ≥ ₪150 כי CPL מצופה ₪300-1000 וצריך גם buffer ל-A/B test.",
    cold_start_advice_he:
      "אל תפרסם מחירי retainer במודעות — זה מסנן יתר. הצעת ערך: 'אבחון של 60 דקות, נראה איפה אתה משאיר כסף על השולחן'. אחרי האבחון אתה סוגר את העסקה. תקציב לקמפיין ראשון ≥ ₪150/יום, ל-21 ימים, ואז בודקים lift.",
    creative_mix: ["video_9_16", "image_4_5", "image_1_1"],
  },
  saas_marketing_tech: {
    // Aiweon's influencer-marketing platform / parent identity
    campaign_type_he: "דמו לפלטפורמת שיווק — Lead Form עם case study",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 130,
    rationale_he:
      "פלטפורמת שיווק (גם Influencer-tech) נמכרת לראשי שיווק עם מחזור החלטה ארוך. דמו דורש מעורבות מנהל שיווק, לעיתים גם CEO. נכון לבחור Lead Form במקום CTWA — ראשי שיווק לא בוחרים פלטפורמת ad tech במייל קצר. תקציב ≥ ₪130/יום.",
    cold_start_advice_he:
      "השקיע ב-3 case studies ויזואליים מ-2 מותגים שעובדים איתך, גם אם הוא קטן. השתמש בקריאייטיב 4:5 פיד עם logo strip ו-stat גדול (לדוגמה 'x4.2 ROI'). השאר 14-21 ימים בלי לגעת.",
    creative_mix: ["image_4_5", "video_9_16", "image_1_1"],
  },
  // ─── Standard B2C service verticals ───
  real_estate_residential: {
    campaign_type_he: "לידים לדירה — Lead Form ממוקד שכונה",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 80,
    rationale_he:
      "נדל\"ן מגורים — קונה רוצה לראות פרטים לפני שמדבר. Lead Form עם שדות נוספים (תקציב, אזור) מסנן יתר ומוריד עומס על המתווך. תקציב ≥ ₪80 כי CPL מצופה ₪180-450.",
    cold_start_advice_he:
      "השתמש ב-3-5 סרטונים של נכסים שונים. טרגוט: זוגות עד גיל 45, באזור ספציפי. אל תרחיב לכל הארץ לפני 50 לידים.",
    creative_mix: ["video_9_16", "image_4_5"],
  },
  home_services: {
    campaign_type_he: "WhatsApp ישיר — אינסטלטור / חשמלאי / שיפוצים",
    objective: "OUTCOME_LEADS",
    channel: "click_to_whatsapp",
    daily_budget_ils_min: 50,
    rationale_he:
      "שירותי בית — קונה רוצה לדבר עכשיו, לא למחר. CTWA דומיננטי כי הליד מגיע מקוון ב-WhatsApp באותו רגע. CPL מצופה ₪70-200, תקציב ≥ ₪50 פותר את ה-Learning.",
    cold_start_advice_he:
      "סרטון 9:16 של 10 שניות שמראה את העבודה. הודעה ראשונה: 'היי, אני {שם}. מה צריך?'. אל תיתן הצעת מחיר במודעה.",
    creative_mix: ["video_9_16", "image_1_1"],
  },
  beauty_aesthetic: {
    campaign_type_he: "ייעוץ חינם — Lead Form עם תיק עבודות",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 60,
    rationale_he:
      "אסתטיקה — קונה רוצה לראות תוצאות לפני שמדבר. Lead Form עם before/after בקריאייטיב. תקציב ≥ ₪60 ל-CPL מצופה ₪70-230.",
    cold_start_advice_he:
      "לפחות 3 וריאציות before/after, 9:16 ו-4:5. טרגוט: גילאי 28-55, נשים בעיקר. אסור להבטיח 'תוצאה תוך X ימים' — Meta תפסול.",
    creative_mix: ["image_4_5", "video_9_16", "image_1_1"],
  },
  legal_personal: {
    campaign_type_he: "התייעצות חינם — Lead Form עם מקרה דמה",
    objective: "OUTCOME_LEADS",
    channel: "lead_form",
    daily_budget_ils_min: 100,
    rationale_he:
      "עו\"ד אישי — לקוח מודאג, צריך אמון. Lead Form עם 'התייעצות חינם 15 דקות' + שדה לסיפור קצר. CPL מצופה ₪200-700, תקציב ≥ ₪100.",
    cold_start_advice_he:
      "סרטון של עו\"ד מדבר ישירות למצלמה, 30 שניות, על מקרה דומה (אנונימי). טרגוט רחב בתחילה — Meta תזהה את המתעניינים.",
    creative_mix: ["video_9_16", "image_4_5"],
  },
};

/**
 * Get the recommendation for a sub-vertical, with fallback to the default.
 */
export function getRecommendation(
  sub: SubVertical | null,
): ServiceCampaignRecommendation {
  if (!sub) return DEFAULT_RECOMMENDATION;
  return SUBVERTICAL_RECOMMENDATIONS[sub] ?? DEFAULT_RECOMMENDATION;
}

/** Hebrew labels for the objective + channel enums. */
export const OBJECTIVE_HE: Record<
  ServiceCampaignRecommendation["objective"],
  string
> = {
  OUTCOME_LEADS: "לידים",
  OUTCOME_ENGAGEMENT: "מעורבות / WhatsApp",
  OUTCOME_SALES: "מכירות",
  OUTCOME_TRAFFIC: "תנועה לאתר",
  OUTCOME_AWARENESS: "מודעות",
};

export const CHANNEL_HE: Record<
  ServiceCampaignRecommendation["channel"],
  string
> = {
  lead_form: "טופס פנימי (Lead Form)",
  click_to_whatsapp: "WhatsApp",
  click_to_messenger: "Messenger",
  click_to_website: "דף נחיתה באתר",
  video_view: "צפיות בסרטון",
};

export const CREATIVE_FORMAT_HE: Record<
  ServiceCampaignRecommendation["creative_mix"][number],
  string
> = {
  video_9_16: "וידאו 9:16 (סטורי/ריל)",
  video_4_5: "וידאו 4:5 (פיד)",
  image_1_1: "תמונה 1:1",
  image_4_5: "תמונה 4:5",
  image_9_16: "תמונה 9:16",
  carousel: "קרוסלה",
};
