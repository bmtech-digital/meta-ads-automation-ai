const IMPACT_KEY_LABEL_HE: Record<string, string> = {
  EXPECTED_CPM_REDUCTION_PCT: "ירידה צפויה בעלות חשיפה",
  EXPECTED_CPM_FLOOR_REDUCTION_PCT: "ירידה צפויה במחיר חשיפה מינימלי",
  EXPECTED_CPA_REDUCTION_PCT: "ירידה צפויה בעלות להמרה",
  EXPECTED_CPL_REDUCTION_PCT: "ירידה צפויה בעלות לליד",
  EXPECTED_CTR_INCREASE_PCT: "עלייה צפויה באחוז הקלקות",
  EXPECTED_ROAS_INCREASE_PCT: "עלייה צפויה בהחזר על הפרסום",
  EXPECTED_LEARNING_EXIT_DAYS: "צפי לסיום שלב הלמידה (ימים)",
  EXPECTED_SPEND_CHANGE_PCT: "שינוי צפוי בהוצאה",
  EXPECTED_REACH_INCREASE_PCT: "עלייה צפויה בכמות החשיפות",
  EXPECTED_PLACEMENT_COVERAGE_CHANGE: "שינוי במיקומים שבהם המודעה מופיעה",
  EXPECTED_HOOK_RATE_INCREASE_PCT: "עלייה צפויה בקצב משיכת תשומת לב",
  confidence: "רמת ביטחון",
};

const CONFIDENCE_LABEL_HE: Record<string, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};

// Value-side translations for impact strings that arrive as enum tokens.
const IMPACT_VALUE_LABEL_HE: Record<string, string> = {
  adds_stories_reels: "מוסיף סטוריז וריילז",
  adds_feed_only: "פיד בלבד",
  adds_reels_only: "מוסיף ריילז",
  adds_stories_only: "מוסיף סטוריז",
  no_change: "ללא שינוי",
};

export interface ImpactRow {
  label: string;
  value: string;
  positive?: boolean;
  note?: string;
}

export function humanImpactRows(
  impact: Record<string, unknown> | null,
): ImpactRow[] {
  if (!impact) return [];
  const rows: ImpactRow[] = [];
  for (const [k, v] of Object.entries(impact)) {
    if (k === "note" || k === "notes") continue;
    // The agent emits both UPPER_SNAKE and lower_snake variants depending on
    // proposal type; normalize to uppercase for the lookup so a single
    // dictionary covers both. Falls back to a humanized lower-snake form
    // (underscores → spaces) rather than the raw English key.
    const upper = k.toUpperCase();
    const label =
      IMPACT_KEY_LABEL_HE[upper] ??
      IMPACT_KEY_LABEL_HE[k] ??
      k.replace(/_/g, " ");
    if (k === "confidence" && typeof v === "string") {
      rows.push({ label, value: CONFIDENCE_LABEL_HE[v] ?? v });
      continue;
    }
    if (typeof v === "number") {
      const isPct = /PCT|PERCENT/i.test(k);
      const isDays = /DAYS/i.test(k);
      const sign = v > 0 ? "+" : "";
      const suffix = isPct ? "%" : isDays ? " ימים" : "";
      const positive = isDays
        ? v < 0
        : /REDUCTION|DECREASE/i.test(k)
          ? v < 0
          : v > 0;
      rows.push({ label, value: `${sign}${v}${suffix}`, positive });
      continue;
    }
    if (typeof v === "string") {
      rows.push({ label, value: IMPACT_VALUE_LABEL_HE[v] ?? v });
    }
  }
  return rows;
}

const PAYLOAD_KEY_LABEL_HE: Record<string, string> = {
  // Diagnostic / performance proposals
  cpm_ratio: "יחס עלות חשיפה מול ממוצע השוק",
  current_cpm_usd: "עלות חשיפה נוכחית ($)",
  benchmark_cpm_il_usd: "ממוצע עלות חשיפה בישראל ($)",
  current_cpa_usd: "עלות נוכחית להמרה ($)",
  benchmark_cpa_il_usd: "ממוצע עלות להמרה בישראל ($)",
  current_cpl_usd: "עלות נוכחית לליד ($)",
  benchmark_cpl_il_usd: "ממוצע עלות לליד בישראל ($)",
  audience_strategy: "אסטרטגיית קהל",
  target_id: "מזהה היעד ב-Meta",
  task_type: "סוג פעולה",
  requires_human_review: "דורש בדיקה אנושית",
  human_review_reason: "סיבת הבדיקה",
  current_budget_ils: "תקציב נוכחי (₪)",
  proposed_budget_ils: "תקציב מוצע (₪)",
  budget_change_pct: "שינוי תקציב (%)",
  learning_phase: "שלב למידה של Meta",
  learning_days: "ימים בלמידה",
  conversions_7d: "המרות ב-7 הימים האחרונים",
  creative_angle: "זווית הקריאייטיב",
  creative_id: "מזהה הקריאייטיב",
  // new_creative payload fields (per creative-guide §5)
  headline: "כותרת",
  primary_text: "טקסט ראשי",
  description: "תיאור (אופציונלי)",
  cta: "כפתור פעולה",
  angle: "סגנון/זווית הפנייה",
  placement: "היכן יוצג",
  image_prompt: "הנחיית AI ליצירת התמונה",
};

// Field values that arrive as enum tokens and need plain-Hebrew translation.
const PAYLOAD_VALUE_LABEL_HE: Record<string, Record<string, string>> = {
  cta: {
    MESSAGE_PAGE: "שלח הודעה לעמוד",
    LEARN_MORE: "מידע נוסף",
    SIGN_UP: "להירשם",
    SHOP_NOW: "לקנות עכשיו",
    CONTACT_US: "צור קשר",
    GET_OFFER: "קבלת הצעה",
    GET_QUOTE: "קבלת הצעת מחיר",
    BOOK_TRAVEL: "להזמין",
    SUBSCRIBE: "להירשם לעדכונים",
    DOWNLOAD: "להוריד",
    APPLY_NOW: "להגיש מועמדות",
    WATCH_MORE: "לצפות בעוד",
  },
  placement: {
    feed: "פיד",
    stories: "סטוריז",
    reels: "ריילז",
    right_column: "טור צד",
    automatic: "בחירה אוטומטית של Meta",
  },
  angle: {
    emotion: "רגש / חוויה",
    urgency: "דחיפות / מבצע",
    benefit: "תועלת ישירה",
    social_proof: "הוכחה חברתית",
    comparison: "השוואה",
    benefits_list: "רשימת יתרונות",
  },
  audience_strategy: {
    broad: "קהל רחב",
    advantage_audience: "הרחבת קהל אוטומטית של Meta",
    custom: "קהל מותאם",
    lookalike: "קהל דומה",
    interest: "קהל לפי תחומי עניין",
  },
  learning_phase: {
    LEARNING: "בלמידה",
    LEARNING_LIMITED: "תקוע בלמידה",
    ACTIVE: "פעיל",
    INACTIVE: "לא פעיל",
  },
};

// Internal-state fields the operator doesn't need to see in the action-details
// section. Available via the raw-JSON drawer for developers.
const PAYLOAD_HIDE = new Set([
  "rationale",
  "rationale_en",
  "rationale_he",
  "summary",
  "model_tier",
  "image_status",
  "image_url",
  "image_path",
  "aspect_ratio",
  "generated_at",
]);

export interface PayloadRow {
  key: string;
  label: string;
  value: string;
}

const EXECUTION_KEY_LABEL_HE: Record<string, string> = {
  id: "מזהה Meta",
  type: "סוג אובייקט",
  status: "סטטוס חדש",
  daily_budget_usd: "תקציב יומי חדש ($)",
  daily_budget_agorot: "תקציב יומי (אגורות)",
  campaign_id: "מזהה קמפיין שנוצר",
  adset_id: "מזהה ad set שנוצר",
  ad_id: "מזהה מודעה שנוצרה",
  creative_id: "מזהה קריאייטיב שנוצר",
  error: "שגיאה",
  details: "פרטי שגיאה",
};

const EXECUTION_HIDE = new Set(["already_executed"]);

export interface ExecutionRow {
  key: string;
  label: string;
  value: string;
  isError?: boolean;
  isId?: boolean;
}

export function humanExecutionRows(
  result: Record<string, unknown> | null,
): ExecutionRow[] {
  if (!result) return [];
  const rows: ExecutionRow[] = [];
  for (const [k, v] of Object.entries(result)) {
    if (EXECUTION_HIDE.has(k)) continue;
    if (v === null || v === undefined) continue;
    const label = EXECUTION_KEY_LABEL_HE[k] ?? k;
    const isError = k === "error";
    const isId = /(^|_)id$/i.test(k);
    let value: string;
    if (typeof v === "string") value = v;
    else if (typeof v === "number")
      value = Number.isInteger(v) ? v.toString() : v.toFixed(2);
    else if (typeof v === "boolean") value = v ? "כן" : "לא";
    else {
      try {
        value = JSON.stringify(v);
      } catch {
        value = String(v);
      }
    }
    rows.push({ key: k, label, value, isError, isId });
  }
  return rows;
}

export function humanPayloadRows(
  payload: Record<string, unknown> | null,
): PayloadRow[] {
  if (!payload) return [];
  const rows: PayloadRow[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (PAYLOAD_HIDE.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    const label = PAYLOAD_KEY_LABEL_HE[k] ?? k;
    let value: string;
    if (typeof v === "boolean") value = v ? "כן" : "לא";
    else if (typeof v === "number")
      value = Number.isInteger(v) ? v.toString() : v.toFixed(2);
    else {
      const raw = String(v);
      value = PAYLOAD_VALUE_LABEL_HE[k]?.[raw] ?? raw;
    }
    rows.push({ key: k, label, value });
  }
  return rows;
}
