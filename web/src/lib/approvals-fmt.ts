import type { Approval, TargetKind, Urgency } from "./db/types";

export const URGENCY_LABEL_HE: Record<Urgency, string> = {
  urgent: "דחוף",
  high: "גבוה",
  medium: "בינוני",
  low: "נמוך",
};

export const URGENCY_STYLES: Record<Urgency, string> = {
  urgent: "bg-destructive/15 text-destructive ring-1 ring-destructive/30",
  high: "bg-brand-500/15 text-brand-500 dark:text-brand-400 ring-1 ring-brand-500/30",
  medium: "bg-warning/15 text-warning ring-1 ring-warning/30",
  low: "bg-muted text-muted-foreground ring-1 ring-border",
};

export const TASK_TYPE_LABEL_HE: Record<string, string> = {
  // Ads
  scale_up: "הגדלת תקציב",
  scale_down: "הקטנת תקציב",
  pause: "השהיה",
  kill_creative: "כיבוי קריאייטיב",
  new_creative: "קריאייטיב חדש",
  expand_audience: "הרחבת קהל",
  consolidate_adsets: "איחוד ad sets",
  increase_budget: "הגדלת תקציב",
  new_campaign: "קמפיין חדש",
  verify_pixel_capi: "אימות Pixel + CAPI",
  // Organic page management (Phase 3)
  publish_fb_post: "פוסט בפייסבוק",
  publish_ig_post: "פוסט באינסטגרם",
  publish_ig_story: "סטורי באינסטגרם",
  publish_ig_reel: "Reel באינסטגרם",
  // Business config
  set_kpi_target: "הגדרת יעד KPI",
  // Gallery → campaign loop (Block 7 + 8, 2026-05-13)
  boost_post: "קידום פוסט אורגני",
  redeploy_creative: "שימוש בקריאייטיב מהגלריה",
  // Informational
  alert: "התראה",
  budget_change: "שינוי תקציב",
  pause_campaign: "השהיית קמפיין",
  resume_campaign: "הפעלת קמפיין",
  pause_adset: "השהיית ad set",
};

export function taskTypeLabel(raw: string): string {
  return TASK_TYPE_LABEL_HE[raw] ?? raw;
}

export const TARGET_KIND_LABEL_HE: Record<TargetKind, string> = {
  campaign: "קמפיין",
  adset: "Ad set",
  ad: "מודעה",
  creative: "קריאייטיב",
  account: "חשבון",
};

export function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

export function relativeHe(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "לפני רגע";
  if (diffMin < 60) return `לפני ${diffMin} דק׳`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `לפני ${diffHr} ש׳`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 14) return `לפני ${diffDay} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

export function formatExpectedImpact(
  impact: Record<string, unknown> | null,
): string | null {
  if (!impact) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(impact)) {
    if (typeof v === "number") {
      const sign = v > 0 ? "+" : "";
      const pct =
        k.toLowerCase().includes("pct") || k.toLowerCase().includes("percent");
      parts.push(`${k.toUpperCase()} ${sign}${v}${pct ? "%" : ""}`);
    } else if (typeof v === "string") {
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Split a rationale string into the explanatory prose and the trailing
 * `**תוכנית:**` (work plan) section, when present.
 *
 * Per [hebrew-copy-style.md §11.6](../../../campaigner/prompts/hebrew-copy-style.md),
 * every operator-facing rationale closes with a numbered plan section so the
 * operator sees the priority chain, not an isolated single action. The plan
 * marker is `**תוכנית:**` on its own line (or with leading/trailing
 * whitespace). Anything after that line is the plan body.
 *
 * Tolerant of variations: `**תוכנית:**`, `**תוכנית**:`, `תוכנית:`, with or
 * without surrounding blank lines. First match wins so spurious mentions in
 * the prose don't trigger a false split.
 */
export function parsePlanSection(
  rationale: string | null | undefined,
): { main: string; plan: string | null } {
  if (!rationale) return { main: "", plan: null };
  const trimmed = rationale.replace(/\r\n/g, "\n");
  const re = /(?:^|\n)\s*(?:\*\*\s*)?תוכנית\s*(?::\*\*|\*\*:|:)\s*\n?/;
  const match = re.exec(trimmed);
  if (!match || match.index === undefined) {
    return { main: trimmed.trim(), plan: null };
  }
  const main = trimmed.slice(0, match.index).replace(/\s+$/, "");
  const plan = trimmed.slice(match.index + match[0].length).trim();
  if (!plan) {
    return { main: trimmed.trim(), plan: null };
  }
  return { main, plan };
}

/**
 * Break a plan body into numbered steps. Recognizes `1.`, `2)`, `3 -`, `4:`
 * markers at line start. Returns the array of step texts (without the
 * marker). If nothing parses as a list, returns a single-item array with the
 * whole body.
 */
export function parsePlanSteps(plan: string): string[] {
  const steps: string[] = [];
  let current = "";
  for (const line of plan.split("\n")) {
    const headerMatch = /^\s*(?:\*\*)?\s*\d+\s*[.)\-:]\s*/.exec(line);
    if (headerMatch) {
      if (current.trim()) steps.push(current.trim());
      current = line.slice(headerMatch[0].length);
    } else {
      current += "\n" + line;
    }
  }
  if (current.trim()) steps.push(current.trim());
  if (steps.length === 0) return [plan.trim()];
  return steps;
}

export function requiresHumanReview(a: Approval): string | null {
  const rhr = (
    a.payload as {
      requires_human_review?: unknown;
      human_review_reason?: unknown;
    }
  )?.requires_human_review;
  if (!rhr) return null;
  const reason = (a.payload as { human_review_reason?: unknown })
    ?.human_review_reason;
  return typeof reason === "string" && reason.length > 0
    ? reason
    : "דורש בדיקה אנושית";
}
