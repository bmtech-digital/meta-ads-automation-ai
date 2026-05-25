import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PulseDot } from "@/components/brand/icons";
import { relativeHe } from "@/lib/approvals-fmt";
import type { AgentDecision, RunSummaryRow } from "@/lib/db/types";
import {
  ACCOUNT_LABEL_HE,
  accountTone,
  BUDGET_LABEL_HE,
  budgetTone,
  summarizeRun,
  TONE_CHIP_CLASS,
  TRACKING_LABEL_HE,
  trackingTone,
  type Tone,
} from "@/lib/runs-summary";

/**
 * Home-page card surfacing the most recent agent run. Per
 * `docs/todos/surface-runs-detail.md`: when the daily scan emits zero
 * proposals (dedup or gates) the operator sees nothing — even though
 * the agent did substantial work. This card is the entry point that
 * makes those observations impossible to miss.
 *
 * Renders gates (budget / tracking / account) as color-coded chips,
 * the top finding as a one-line headline, and a CTA into the full
 * /runs/[run_id] detail page.
 */
export function LastScanCard({
  run,
  decisions,
}: {
  run: RunSummaryRow;
  /** Full decision trail for the same run — used to extract gates + top finding. */
  decisions: AgentDecision[];
}) {
  const h = summarizeRun(decisions);
  const headlineParts: string[] = [];
  headlineParts.push(`${run.campaigns_touched} קמפיינים נסרקו`);
  headlineParts.push(`${h.proposalCount} הצעות`);
  if (h.observationBlockedCount > 0)
    headlineParts.push(`${h.observationBlockedCount} ממצאים חסומים`);
  if (h.skipCount > 0) headlineParts.push(`${h.skipCount} דילוגים`);
  if (h.rejectionCount > 0) headlineParts.push(`${h.rejectionCount} דחיות`);

  const tone: Tone = h.hasErrors
    ? "bad"
    : h.proposalCount > 0
      ? "good"
      : "neutral";

  return (
    <section>
      <div className="glass-surface overflow-hidden rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <PulseDot tone={h.hasErrors ? "error" : "success"} />
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">
                סריקה אחרונה · {relativeHe(run.ended_at)}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {headlineParts.join(" · ")}
              </span>
            </div>
          </div>
          <Link
            href={`/runs/${run.run_id}`}
            className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-card/40 px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-muted/40"
          >
            פתח את הריצה
            <ArrowLeft size={12} />
          </Link>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {h.budgetStatus ? (
              <GateChip
                tone={budgetTone(h.budgetStatus)}
                label={BUDGET_LABEL_HE[h.budgetStatus]}
                extra={
                  h.budgetPace !== null
                    ? `${Math.round(h.budgetPace * 100)}% מהצפוי`
                    : undefined
                }
              />
            ) : null}
            {h.trackingStatus ? (
              <GateChip
                tone={trackingTone(h.trackingStatus)}
                label={TRACKING_LABEL_HE[h.trackingStatus]}
              />
            ) : null}
            {h.accountBand ? (
              <GateChip
                tone={accountTone(h.accountBand)}
                label={ACCOUNT_LABEL_HE[h.accountBand]}
              />
            ) : null}
          </div>

          {h.topFinding ? (
            <div
              className={
                "rounded-md border px-3 py-2.5 text-[13px] leading-relaxed " +
                topFindingClass(tone)
              }
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wider opacity-80">
                {topFindingEyebrowHe(h.topFinding.kind)}
              </div>
              <div className="mt-0.5 font-medium">{h.topFinding.text}</div>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground">
              הריצה הזו עברה ללא ממצא חריג — לפרטים מלאים פתח את הריצה.
            </div>
          )}

          {h.blockedFindings.length > 0 ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2.5 text-[12.5px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-100">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider opacity-80">
                ממצאים שמחכים להסרת חסם
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {h.blockedFindings.map((f) => (
                  <li key={f.decisionId} className="flex flex-col gap-0.5">
                    <span className="font-medium">{f.summary}</span>
                    {f.blockedBy.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {f.blockedBy.map((b) => (
                          <span
                            key={b}
                            className="rounded bg-amber-200 px-1.5 py-0.5 text-[10.5px] font-mono text-amber-900"
                          >
                            🔒 {b}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GateChip({
  tone,
  label,
  extra,
}: {
  tone: Tone;
  label: string;
  extra?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium " +
        TONE_CHIP_CLASS[tone]
      }
    >
      <span>{label}</span>
      {extra ? <span className="font-tabular opacity-80">· {extra}</span> : null}
    </span>
  );
}

function topFindingClass(tone: Tone): string {
  switch (tone) {
    case "bad":
      return "border-red-300/60 bg-red-50/40 text-red-900 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-200";
    case "good":
      return "border-emerald-300/60 bg-emerald-50/40 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/10 dark:text-emerald-100";
    case "warn":
      return "border-amber-300/60 bg-amber-50/40 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-200";
    default:
      return "border-border/60 bg-muted/30 text-foreground";
  }
}

function topFindingEyebrowHe(kind: NonNullable<ReturnType<typeof summarizeRun>["topFinding"]>["kind"]): string {
  switch (kind) {
    case "error":
      return "שגיאה בריצה";
    case "scale_up":
      return "מועמד להגדלת תקציב";
    case "scale_down":
      return "מועמד להקטנת תקציב";
    case "pool":
      return "פול קריאייטיב";
    case "proposal":
      return "הצעה חדשה";
    case "blocked":
      return "ממצא חסום";
    case "route":
      return "ממצא ראשי";
  }
}
