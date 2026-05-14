import type { Business } from "./db/types";

export type TokenState =
  | { kind: "unknown" }
  | { kind: "expired"; daysAgo: number }
  | { kind: "critical"; daysLeft: number }
  | { kind: "warning"; daysLeft: number }
  | { kind: "healthy"; daysLeft: number };

const CRITICAL_DAYS = 3;
const WARNING_DAYS = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function tokenExpiryState(
  business: Business,
  now: Date = new Date(),
): TokenState {
  if (!business.meta_access_token_expires_at) return { kind: "unknown" };

  const expiresAt = new Date(business.meta_access_token_expires_at).getTime();
  if (Number.isNaN(expiresAt)) return { kind: "unknown" };

  const diffDays = Math.floor((expiresAt - now.getTime()) / MS_PER_DAY);
  if (diffDays < 0) return { kind: "expired", daysAgo: Math.abs(diffDays) };
  if (diffDays <= CRITICAL_DAYS)
    return { kind: "critical", daysLeft: diffDays };
  if (diffDays <= WARNING_DAYS) return { kind: "warning", daysLeft: diffDays };
  return { kind: "healthy", daysLeft: diffDays };
}

export function tokenStateLabelHe(state: TokenState): string {
  switch (state.kind) {
    case "unknown":
      return "לא חובר";
    case "expired":
      return `הטוקן פג לפני ${state.daysAgo} ימים`;
    case "critical":
      return state.daysLeft === 0
        ? "הטוקן פג היום"
        : `הטוקן פג בעוד ${state.daysLeft} ימים`;
    case "warning":
      // Surface the countdown only once we're inside the 10-day window —
      // before that "מחובר" is the truth the operator cares about.
      return `מחובר · פג בעוד ${state.daysLeft} ימים`;
    case "healthy":
      return "מחובר";
  }
}

/** Tailwind classes for a badge matching the state severity. */
export function tokenStateStyles(state: TokenState): string {
  switch (state.kind) {
    case "healthy":
      return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "unknown":
      return "bg-slate-100 text-slate-800 border-slate-300";
    case "warning":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "critical":
    case "expired":
      return "bg-red-100 text-red-900 border-red-300";
  }
}

export function isTokenActionable(state: TokenState): boolean {
  return (
    state.kind === "warning" ||
    state.kind === "critical" ||
    state.kind === "expired"
  );
}
