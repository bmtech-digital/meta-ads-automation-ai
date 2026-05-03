const IMPACT_KEY_LABEL_HE: Record<string, string> = {
  EXPECTED_CPM_REDUCTION_PCT: "ירידת CPM צפויה",
  EXPECTED_CPA_REDUCTION_PCT: "ירידת CPA צפויה",
  EXPECTED_CPL_REDUCTION_PCT: "ירידת CPL צפויה",
  EXPECTED_CTR_INCREASE_PCT: "עליית CTR צפויה",
  EXPECTED_ROAS_INCREASE_PCT: "עליית ROAS צפויה",
  EXPECTED_LEARNING_EXIT_DAYS: "יציאה מ-Learning בעוד",
  EXPECTED_SPEND_CHANGE_PCT: "שינוי הוצאה צפוי",
  EXPECTED_REACH_INCREASE_PCT: "עליית Reach צפויה",
  confidence: "רמת ביטחון",
};

const CONFIDENCE_LABEL_HE: Record<string, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};

export interface ImpactRow {
  label: string;
  value: string;
  positive?: boolean;
  note?: string;
}

export function humanImpactRows(impact: Record<string, unknown> | null): ImpactRow[] {
  if (!impact) return [];
  const rows: ImpactRow[] = [];
  for (const [k, v] of Object.entries(impact)) {
    if (k === "note" || k === "notes") continue;
    const label = IMPACT_KEY_LABEL_HE[k] ?? k;
    if (k === "confidence" && typeof v === "string") {
      rows.push({ label, value: CONFIDENCE_LABEL_HE[v] ?? v });
      continue;
    }
    if (typeof v === "number") {
      const isPct = /PCT|PERCENT/i.test(k);
      const isDays = /DAYS/i.test(k);
      const sign = v > 0 ? "+" : "";
      const suffix = isPct ? "%" : isDays ? " ימים" : "";
      const positive = isDays ? v < 0 : /REDUCTION|DECREASE/i.test(k) ? v < 0 : v > 0;
      rows.push({ label, value: `${sign}${v}${suffix}`, positive });
      continue;
    }
    if (typeof v === "string") {
      rows.push({ label, value: v });
    }
  }
  return rows;
}

const PAYLOAD_KEY_LABEL_HE: Record<string, string> = {
  cpm_ratio: "יחס CPM מול benchmark",
  current_cpm_usd: "CPM נוכחי ($)",
  benchmark_cpm_il_usd: "Benchmark CPM ישראל ($)",
  current_cpa_usd: "CPA נוכחי ($)",
  benchmark_cpa_il_usd: "Benchmark CPA ישראל ($)",
  current_cpl_usd: "CPL נוכחי ($)",
  benchmark_cpl_il_usd: "Benchmark CPL ישראל ($)",
  audience_strategy: "אסטרטגיית קהל",
  target_id: "מזהה יעד",
  task_type: "סוג פעולה",
  requires_human_review: "דורש בדיקה אנושית",
  human_review_reason: "סיבת הבדיקה",
  current_budget_ils: "תקציב נוכחי (₪)",
  proposed_budget_ils: "תקציב מוצע (₪)",
  budget_change_pct: "שינוי תקציב (%)",
  learning_phase: "שלב Learning",
  learning_days: "ימים ב-Learning",
  conversions_7d: "המרות (7 ימים)",
  creative_angle: "זווית קריאייטיב",
  creative_id: "מזהה קריאייטיב",
};

const PAYLOAD_HIDE = new Set(["rationale", "rationale_en", "rationale_he"]);

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

export function humanExecutionRows(result: Record<string, unknown> | null): ExecutionRow[] {
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
    else if (typeof v === "number") value = Number.isInteger(v) ? v.toString() : v.toFixed(2);
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

export function humanPayloadRows(payload: Record<string, unknown> | null): PayloadRow[] {
  if (!payload) return [];
  const rows: PayloadRow[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (PAYLOAD_HIDE.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    const label = PAYLOAD_KEY_LABEL_HE[k] ?? k;
    let value: string;
    if (typeof v === "boolean") value = v ? "כן" : "לא";
    else if (typeof v === "number") value = Number.isInteger(v) ? v.toString() : v.toFixed(2);
    else value = String(v);
    rows.push({ key: k, label, value });
  }
  return rows;
}
