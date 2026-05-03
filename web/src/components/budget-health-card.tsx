import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeHe } from "@/lib/approvals-fmt";
import type { AgentDecision, Business } from "@/lib/db/types";

/**
 * Budget-health card — renders the latest `budget_health` observation written
 * by the agent's Step 0 pace check (decisions-log §1.10 / compute_monthly_pace).
 *
 * Used on the home dashboard and at the top of /approvals. Read-only; the only
 * way to raise the cap is to approve a `raise_monthly_budget` alert.
 */

type PaceStatus = "ok" | "overrun" | "underrun" | "no_budget_set";

interface PaceOutputs {
  pace?: number | null;
  status?: PaceStatus;
  spend_this_month?: number;
  projected_monthly_spend?: number;
  effective_monthly_budget?: number;
  days_elapsed?: number;
  days_in_month?: number;
  days_left?: number;
  seasonal_multiplier?: number;
  active_windows?: Array<{ name?: string; multiplier?: number; start?: string; end?: string }>;
}

function statusTone(status: PaceStatus | undefined): {
  label: string;
  accent: string;
  headline: string;
} {
  switch (status) {
    case "overrun":
      return {
        label: "חריגה בקצב",
        accent: "border-destructive/40 bg-destructive/5",
        headline: "text-destructive",
      };
    case "underrun":
      return {
        label: "תת-ניצול",
        accent: "border-sky-500/30 bg-sky-500/5",
        headline: "text-sky-600 dark:text-sky-400",
      };
    case "no_budget_set":
      return {
        label: "תקציב חודשי לא מוגדר",
        accent: "border-border bg-muted/30",
        headline: "text-muted-foreground",
      };
    case "ok":
    default:
      return {
        label: "בקצב",
        accent: "border-border bg-card/40",
        headline: "text-foreground",
      };
  }
}

function formatIls(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}

export function BudgetHealthCard({
  business,
  decision,
}: {
  business: Business;
  decision: AgentDecision | null;
}) {
  if (!decision) {
    return (
      <Card className="border-border bg-card/40">
        <CardHeader>
          <CardTitle>💰 תקציב בריא?</CardTitle>
          <CardDescription>
            אין pace היום — הסוכן עוד לא רץ.{" "}
            {business.monthly_budget_ils
              ? `תקציב חודשי מוגדר: ${formatIls(Number(business.monthly_budget_ils))}.`
              : "ולא מוגדר תקציב חודשי — ראה הגדרות."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const outputs = (decision.outputs ?? {}) as PaceOutputs;
  const status: PaceStatus = (outputs.status as PaceStatus) ?? "ok";
  const tone = statusTone(status);
  const pacePct =
    outputs.pace !== undefined && outputs.pace !== null
      ? `${Math.round(outputs.pace * 100)}%`
      : "—";
  const windows = outputs.active_windows ?? [];

  return (
    <Card className={tone.accent}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>💰 תקציב בריא?</CardTitle>
          <CardDescription className={tone.headline}>
            {tone.label}
            {outputs.pace !== undefined && outputs.pace !== null ? ` · ${pacePct} מהצפוי` : ""}
          </CardDescription>
        </div>
        <span className="text-[11px] text-muted-foreground">
          עודכן {relativeHe(decision.created_at)}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            label="הוצאה מתחילת החודש"
            value={formatIls(outputs.spend_this_month)}
            hint={
              outputs.effective_monthly_budget
                ? `מתוך ${formatIls(outputs.effective_monthly_budget)}`
                : undefined
            }
          />
          <Metric
            label="תחזית סוף חודש"
            value={formatIls(outputs.projected_monthly_spend)}
            hint={
              outputs.effective_monthly_budget && outputs.projected_monthly_spend !== undefined
                ? outputs.projected_monthly_spend > outputs.effective_monthly_budget
                  ? `₪${Math.round(
                      outputs.projected_monthly_spend - outputs.effective_monthly_budget,
                    ).toLocaleString("he-IL")} מעל הצפוי`
                  : `₪${Math.round(
                      outputs.effective_monthly_budget - outputs.projected_monthly_spend,
                    ).toLocaleString("he-IL")} headroom`
                : undefined
            }
          />
          <Metric
            label="יום בחודש"
            value={
              outputs.days_elapsed !== undefined && outputs.days_in_month !== undefined
                ? `${outputs.days_elapsed} / ${outputs.days_in_month}`
                : "—"
            }
            hint={outputs.days_left !== undefined ? `${outputs.days_left} ימים נותרו` : undefined}
          />
          <Metric
            label="מכפיל עונתי"
            value={
              outputs.seasonal_multiplier !== undefined
                ? `×${Number(outputs.seasonal_multiplier).toFixed(2)}`
                : "×1.00"
            }
            hint={windows.length > 0 ? `${windows.length} חלונות פעילים` : "אין חלון פעיל"}
          />
        </div>

        {windows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">חלונות פעילים:</span>
            {windows.map((w, i) => (
              <Badge key={`${w.name}-${i}`} variant="outline" className="font-normal">
                {w.name ?? "חלון"}
                {typeof w.multiplier === "number" ? ` ×${w.multiplier.toFixed(2)}` : null}
              </Badge>
            ))}
          </div>
        ) : null}

        {status === "overrun" ? (
          <p className="text-xs text-destructive">
            הסוכן פתח הצעות pause/scale_down או alert לחריגה בסבב האחרון — בדוק את ה-queue של האישורים.
          </p>
        ) : null}
        {status === "underrun" ? (
          <p className="text-xs text-muted-foreground">
            תת-ניצול עקבי עם winner → ייתכן שהסוכן יציע הגדלה (§T10). אם לא — כנראה שאין winner לעת עתה.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-tabular text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
