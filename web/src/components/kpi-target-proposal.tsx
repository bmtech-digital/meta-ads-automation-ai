import { Badge } from "@/components/ui/badge";
import type { Approval } from "@/lib/db/types";

/**
 * KpiTargetProposalView — rendered on the approval detail page when
 * task_type='set_kpi_target'. The agent researched the market live (via
 * WebSearch grounded in business_knowledge), recommends a target value,
 * compares actual performance, and lays out the plan to hit it. This
 * component surfaces all of that so the operator's approve/reject decision
 * is informed.
 *
 * Read-only. The agent rewrote the proposal → reject it; the agent will
 * propose again with the new context.
 */

interface ResearchSource {
  title?: string;
  url?: string;
  extracted?: string;
}

interface ResearchBlock {
  market_average?: number;
  range_low?: number;
  range_high?: number;
  currency?: string | null;
  sources?: ResearchSource[];
  context_used?: string[];
  researched_at?: string;
}

interface ComparisonBlock {
  current_actual?: number | null;
  vs_market_pct?: number | null;
  vs_target_pct?: number | null;
}

interface KpiTargetPayload {
  kpi?: "cpa" | "cpl" | "roas";
  value?: number;
  research?: ResearchBlock;
  comparison?: ComparisonBlock;
  plan?: string;
}

const KPI_LABEL: Record<string, string> = {
  cpa: "עלות להמרה (CPA)",
  cpl: "עלות לליד (CPL)",
  roas: "החזר על הפרסום (ROAS)",
};

function fmtMoney(value: number | null | undefined, kpi?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (kpi === "roas") return `${value.toFixed(1)}x`;
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}%`;
}

export function isSetKpiTargetTask(taskType: string): boolean {
  return taskType === "set_kpi_target";
}

export function KpiTargetProposalView({ approval }: { approval: Approval }) {
  if (!isSetKpiTargetTask(approval.task_type)) return null;
  const payload = (approval.payload ?? {}) as KpiTargetPayload;
  const kpi = payload.kpi;
  const kpiLabel = kpi ? KPI_LABEL[kpi] : "יעד KPI";
  const target = payload.value;
  const research = payload.research;
  const comparison = payload.comparison;
  const plan = payload.plan;

  // Verdict for the comparison (lower=better for CPA/CPL, higher=better for ROAS)
  const lowerIsBetter = kpi === "cpa" || kpi === "cpl";
  let comparisonTone: "good" | "ok" | "warn" | null = null;
  let comparisonLabel = "";
  if (
    comparison?.current_actual !== null &&
    comparison?.current_actual !== undefined &&
    comparison?.vs_market_pct !== null &&
    comparison?.vs_market_pct !== undefined
  ) {
    const pct = comparison.vs_market_pct;
    if (lowerIsBetter) {
      if (pct <= -10) {
        comparisonTone = "good";
        comparisonLabel = "מתחת לממוצע השוק — טוב";
      } else if (pct <= 10) {
        comparisonTone = "ok";
        comparisonLabel = "סביב הממוצע";
      } else {
        comparisonTone = "warn";
        comparisonLabel = "מעל הממוצע — יש מה לשפר";
      }
    } else {
      // ROAS
      if (pct >= 10) {
        comparisonTone = "good";
        comparisonLabel = "מעל הממוצע — טוב";
      } else if (pct >= -10) {
        comparisonTone = "ok";
        comparisonLabel = "סביב הממוצע";
      } else {
        comparisonTone = "warn";
        comparisonLabel = "מתחת לממוצע — יש מה לשפר";
      }
    }
  }
  const toneClass = {
    good: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200",
    ok: "bg-muted text-muted-foreground border-border",
    warn: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200",
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            {kpiLabel}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <div className="text-[26px] font-semibold leading-none tracking-[-0.02em]">
              {fmtMoney(target, kpi)}
            </div>
            <div className="text-[12px] text-muted-foreground">
              היעד המומלץ של הסוכן
            </div>
          </div>
        </div>
        {comparisonTone ? (
          <Badge className={toneClass[comparisonTone]}>{comparisonLabel}</Badge>
        ) : (
          <Badge className="border-border bg-muted text-muted-foreground">
            עוד אין ביצוע חי להשוואה
          </Badge>
        )}
      </header>

      {/* Three-column comparison strip: market / your actual / your target */}
      <div className="grid grid-cols-3 gap-2">
        <ComparisonTile
          label="ממוצע שוק"
          value={fmtMoney(research?.market_average, kpi)}
          sub={
            research?.range_low !== undefined && research?.range_high !== undefined
              ? `טווח ${fmtMoney(research.range_low, kpi)} – ${fmtMoney(research.range_high, kpi)}`
              : null
          }
        />
        <ComparisonTile
          label="הביצוע שלך"
          value={fmtMoney(comparison?.current_actual, kpi)}
          sub={
            comparison?.vs_market_pct !== null &&
            comparison?.vs_market_pct !== undefined
              ? `${fmtPct(comparison.vs_market_pct)} מול השוק`
              : "אין נתונים — עוד לא רץ קמפיין"
          }
        />
        <ComparisonTile
          label="היעד המומלץ"
          value={fmtMoney(target, kpi)}
          sub={
            comparison?.vs_target_pct !== null &&
            comparison?.vs_target_pct !== undefined
              ? `${fmtPct(comparison.vs_target_pct)} מהיעד`
              : null
          }
          accent
        />
      </div>

      {/* Plan */}
      {plan ? (
        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            איך מגיעים ליעד
          </div>
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed">
            {plan}
          </p>
        </div>
      ) : null}

      {/* Sources — collapsible if many */}
      {research?.sources && research.sources.length > 0 ? (
        <details className="group rounded-md border border-dashed border-border bg-card/30 p-3 text-[12.5px]">
          <summary className="cursor-pointer select-none font-semibold text-muted-foreground">
            מקורות שהסוכן בדק ({research.sources.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {research.sources.map((s, idx) => (
              <li key={idx} className="border-r-2 border-border ps-3">
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {s.title ?? s.url}
                  </a>
                ) : (
                  <div className="font-medium">{s.title ?? "—"}</div>
                )}
                {s.extracted ? (
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {s.extracted}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Context used — what shaped this recommendation */}
      {research?.context_used && research.context_used.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="font-semibold">מבוסס על:</span>
          {research.context_used.map((c) => (
            <span
              key={c}
              className="rounded-full bg-muted px-2 py-0.5"
              dir="auto"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}

      {research?.researched_at ? (
        <footer className="border-t border-border pt-2 text-[10.5px] text-muted-foreground">
          המחקר נערך{" "}
          {new Date(research.researched_at).toLocaleString("he-IL", {
            timeZone: "Asia/Jerusalem",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </footer>
      ) : null}
    </section>
  );
}

function ComparisonTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-2.5 " +
        (accent
          ? "border-brand-400 bg-brand-50/40 dark:bg-brand-400/10"
          : "border-border bg-background")
      }
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-tabular text-[18px] font-semibold leading-none tracking-[-0.02em]">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[10.5px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}
