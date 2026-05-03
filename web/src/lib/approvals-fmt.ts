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
  scale_up: "הגדלת תקציב",
  scale_down: "הקטנת תקציב",
  pause: "השהיה",
  kill_creative: "כיבוי קריאייטיב",
  new_creative: "קריאייטיב חדש",
  expand_audience: "הרחבת קהל",
  consolidate_adsets: "איחוד ad sets",
  increase_budget: "הגדלת תקציב",
  new_campaign: "קמפיין חדש",
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

export function formatExpectedImpact(impact: Record<string, unknown> | null): string | null {
  if (!impact) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(impact)) {
    if (typeof v === "number") {
      const sign = v > 0 ? "+" : "";
      const pct = k.toLowerCase().includes("pct") || k.toLowerCase().includes("percent");
      parts.push(`${k.toUpperCase()} ${sign}${v}${pct ? "%" : ""}`);
    } else if (typeof v === "string") {
      parts.push(`${k}: ${v}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}


export function requiresHumanReview(a: Approval): string | null {
  const rhr = (a.payload as { requires_human_review?: unknown; human_review_reason?: unknown })?.requires_human_review;
  if (!rhr) return null;
  const reason = (a.payload as { human_review_reason?: unknown })?.human_review_reason;
  return typeof reason === "string" && reason.length > 0 ? reason : "דורש בדיקה אנושית";
}
