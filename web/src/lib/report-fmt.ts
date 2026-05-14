/**
 * Hebrew formatters for the monthly client-facing report (/reports/[month]).
 * Block 10 (2026-05-13). Pure functions — no I/O, no date.now() at module scope.
 */

const HEBREW_MONTH: Record<string, string> = {
  "01": "ינואר",
  "02": "פברואר",
  "03": "מרץ",
  "04": "אפריל",
  "05": "מאי",
  "06": "יוני",
  "07": "יולי",
  "08": "אוגוסט",
  "09": "ספטמבר",
  "10": "אוקטובר",
  "11": "נובמבר",
  "12": "דצמבר",
};

/** "2026-05" → "מאי 2026". Returns the raw input if unparseable. */
export function monthLabelHe(yyyyMm: string): string {
  const parts = yyyyMm.split("-");
  if (parts.length !== 2) return yyyyMm;
  const name = HEBREW_MONTH[parts[1]];
  if (!name) return yyyyMm;
  return `${name} ${parts[0]}`;
}

/** ₪ formatter — handles null gracefully ("—"). */
export function ilsHe(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

/** % formatter — accepts 0..100 (not 0..1). */
export function pctHe(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(0)}%`;
}

/** Pace bucket — drives the badge color + label in the report header. */
export function paceBucket(
  pacePct: number | null,
): { label: string; tone: "good" | "warn" | "alert" | "neutral" } {
  if (pacePct === null) return { label: "אין נתוני קצב", tone: "neutral" };
  if (pacePct < 50) return { label: "תת-ניצול", tone: "alert" };
  if (pacePct < 80) return { label: "ניצול חלקי", tone: "warn" };
  if (pacePct <= 110) return { label: "תקין", tone: "good" };
  return { label: "חורג מתקציב", tone: "alert" };
}

/**
 * decision_type → Hebrew label. The agent_decisions table records every
 * step the agent took; we summarize the distribution in the report header.
 */
export const DECISION_TYPE_LABEL_HE: Record<string, string> = {
  observation: "תצפיות",
  diagnosis: "אבחנות",
  proposal: "הצעות",
  rejection: "דחיות (גארדריילים)",
  execution: "ביצועים",
  skip: "דילוגים",
  error: "שגיאות",
};

export function decisionTypeLabel(raw: string): string {
  return DECISION_TYPE_LABEL_HE[raw] ?? raw;
}

/**
 * Honest provenance label for the budget snapshot. The report has to be
 * transparent about whether the number is from a fresh agent run or
 * missing entirely.
 */
export function budgetSourceLabel(
  source: "budget_health_snapshot" | "unavailable",
  snapshotAt: string | null,
  nowIso: string,
): string {
  if (source === "unavailable")
    return "נתוני תקציב לא נשמרו לחודש הזה — צריך ריצת agent כדי לחשב.";
  if (!snapshotAt) return "מקור: snapshot אחרון של הסוכן.";
  const ageHours =
    (new Date(nowIso).getTime() - new Date(snapshotAt).getTime()) /
    (1000 * 60 * 60);
  if (ageHours < 24) return "מקור: snapshot אחרון של הסוכן (היום).";
  if (ageHours < 48) return "מקור: snapshot אחרון של הסוכן (אתמול).";
  const days = Math.round(ageHours / 24);
  return `מקור: snapshot אחרון של הסוכן (לפני ${days} ימים).`;
}

/**
 * Render an absolute date in a short Hebrew form. Pure — takes the ISO
 * string and a "now" reference for relative phrasing decisions.
 */
export function shortDateHe(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
