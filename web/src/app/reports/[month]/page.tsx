import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  taskTypeLabel,
} from "@/lib/approvals-fmt";
import {
  budgetSourceLabel,
  decisionTypeLabel,
  ilsHe,
  monthLabelHe,
  paceBucket,
  pctHe,
  shortDateHe,
} from "@/lib/report-fmt";
import type { MonthlyReport } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ month: string }>;
}): Promise<Metadata> {
  const { month } = await params;
  return { title: `דוח חודשי ${monthLabelHe(month)}` };
}

/**
 * /reports/[month] — full monthly client-facing report. Reads aggregated
 * data via `db.getMonthlyReport`. Block 10 (2026-05-13).
 *
 * Sections:
 *   1. Header (business, month, pace badge)
 *   2. Top-line budget (spend, projection, vs target)
 *   3. Agent activity (decision-type counts)
 *   4. Approvals breakdown (status + per task_type executed)
 *   5. Creative output (counts of new_creative/redeploy/boost/organic)
 *   6. Highlights — top high-urgency executed approvals
 *   7. Open alerts — forward-looking pending alert proposals
 */
export default async function MonthlyReportPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  const { month } = await params;
  if (!MONTH_PATTERN.test(month)) notFound();
  if (!session) redirect(`/login?next=/reports/${month}`);

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/reports">
        <PageHeader eyebrow="דוחות" title="דוח חודשי" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
            <CardDescription>בחר עסק בתפריט.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const report: MonthlyReport = await db.getMonthlyReport(business.id, month);

  const pace = paceBucket(report.budget.pace_pct);

  return (
    <Shell active="/reports">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-foreground">
          דוחות חודשיים
        </Link>
        <ChevronRight size={14} className="opacity-50" />
        <span className="text-foreground">{monthLabelHe(month)}</span>
      </nav>

      <PageHeader
        eyebrow={`דוח חודשי · ${business.name}`}
        title={monthLabelHe(month)}
        subtitle={`חלון נתונים: ${shortDateHe(report.window_start)} – ${shortDateHe(report.window_end)} · הדוח נוצר ב-${shortDateHe(report.generated_at)}.`}
        actions={
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ring-1",
              pace.tone === "good" &&
                "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
              pace.tone === "warn" &&
                "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300",
              pace.tone === "alert" &&
                "bg-destructive/10 text-destructive ring-destructive/30",
              pace.tone === "neutral" &&
                "bg-muted text-muted-foreground ring-border",
            )}
          >
            {pace.label}
          </span>
        }
      />

      {/* Section 1: Budget top-line */}
      <SectionHeader
        title="תקציב והוצאה"
        description={budgetSourceLabel(
          report.budget.spend_source,
          report.budget.snapshot_at,
          report.generated_at,
        )}
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox
          label="הוצאה החודש"
          value={ilsHe(report.budget.spend_ils)}
        />
        <KpiBox
          label="תקציב חודשי מתוכנן"
          value={ilsHe(report.budget.monthly_budget_ils)}
        />
        <KpiBox label="קצב ניצול" value={pctHe(report.budget.pace_pct)} />
        <KpiBox
          label="צפי לסוף חודש"
          value={ilsHe(report.budget.projected_monthly_ils)}
        />
      </div>

      {/* Section 2: Agent activity */}
      <SectionHeader
        title="פעילות הסוכן"
        description={`סה"כ ${report.agent_activity.total_decisions.toLocaleString("he-IL")} החלטות נרשמו החודש.`}
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(report.agent_activity.by_type)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <KpiBox
              key={type}
              label={decisionTypeLabel(type)}
              value={count.toLocaleString("he-IL")}
            />
          ))}
        {report.agent_activity.total_decisions === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-4">
            <CardContent className="py-6 text-sm text-muted-foreground">
              לא נרשמה פעילות סוכן בחודש זה.
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Section 3: Approvals breakdown */}
      <SectionHeader
        title="הצעות לאישור"
        description="ההצעות שהסוכן שלח החודש, לפי סטטוס וסוג."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiBox
          label="סה״כ הוצעו"
          value={report.approvals.proposed.toLocaleString("he-IL")}
        />
        <KpiBox
          label="בוצעו"
          value={report.approvals.executed.toLocaleString("he-IL")}
          tone="good"
        />
        <KpiBox
          label="ממתינות"
          value={report.approvals.pending.toLocaleString("he-IL")}
          tone={report.approvals.pending > 0 ? "warn" : "neutral"}
        />
        <KpiBox
          label="נדחו"
          value={report.approvals.rejected.toLocaleString("he-IL")}
        />
        <KpiBox
          label="פגו"
          value={report.approvals.expired.toLocaleString("he-IL")}
        />
      </div>
      {Object.keys(report.approvals.by_task_type).length > 0 ? (
        <Card className="mb-10">
          <CardHeader>
            <CardTitle>פירוט ביצועים לפי סוג פעולה</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(report.approvals.by_task_type)
                .sort((a, b) => b[1] - a[1])
                .map(([taskType, count]) => (
                  <div
                    key={taskType}
                    className="flex items-baseline justify-between border-b border-border/50 py-1.5"
                  >
                    <dt className="text-sm">{taskTypeLabel(taskType)}</dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {count.toLocaleString("he-IL")}
                    </dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {/* Section 4: Creative output */}
      <SectionHeader
        title="פעילות קריאייטיב"
        description="קריאייטיבים חדשים, שימוש חוזר מהגלריה, ופרסום אורגני."
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox
          label="קריאייטיבים חדשים"
          value={report.creative_output.new_creatives.toLocaleString("he-IL")}
        />
        <KpiBox
          label="שימוש חוזר מהגלריה"
          value={report.creative_output.redeployed.toLocaleString("he-IL")}
        />
        <KpiBox
          label="קידום פוסטים אורגניים"
          value={report.creative_output.boosted_posts.toLocaleString("he-IL")}
        />
        <KpiBox
          label="פרסומים אורגניים"
          value={report.creative_output.organic_published.toLocaleString(
            "he-IL",
          )}
        />
      </div>

      {/* Section 5: Highlights */}
      {report.approvals.highlights.length > 0 ? (
        <>
          <SectionHeader
            title="ההחלטות המשמעותיות"
            description="הצעות בעלות עדיפות גבוהה שבוצעו החודש (מקסימום 6, ממוינות לפי דחיפות)."
          />
          <div className="mb-10 space-y-3">
            {report.approvals.highlights.map((h) => {
              const urgency: keyof typeof URGENCY_LABEL_HE =
                h.urgency === "urgent" ||
                h.urgency === "high" ||
                h.urgency === "low"
                  ? h.urgency
                  : "medium";
              return (
                <Link
                  key={h.id}
                  href={`/approvals/${h.id}`}
                  className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">
                      {taskTypeLabel(h.task_type)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        URGENCY_STYLES[urgency] ?? URGENCY_STYLES.medium,
                      )}
                    >
                      {URGENCY_LABEL_HE[urgency] ?? "בינוני"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                    {h.rationale || "אין הסבר מצורף."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    בוצע: {shortDateHe(h.executed_at)}
                  </p>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Section: A/B tests decided this month — wires Block 11 into Block 10 */}
      {report.ab_tests.count_decided + report.ab_tests.count_cancelled > 0 ? (
        <>
          <SectionHeader
            title="מבחני A/B שנסגרו החודש"
            description={
              report.ab_tests.count_decided + report.ab_tests.count_cancelled > 0
                ? `${report.ab_tests.count_decided} עם וריאנט זוכה · ${report.ab_tests.count_cancelled} בוטלו`
                : "אין מבחנים שהוחלטו החודש."
            }
          />
          <div className="mb-10 space-y-3">
            {report.ab_tests.decided.map((t) => {
              const winnerLabel = t.winner_variant_label
                ? `וריאנט ${t.winner_variant_label}`
                : "בוטל ללא מנצח";
              const conf = t.confidence ?? "—";
              return (
                <Link
                  key={t.id}
                  href={`/ab-tests/${t.id}`}
                  className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{t.test_name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        t.status === "decided"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {winnerLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                    {t.decision_reason || "לא סופק הסבר."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    הוחלט: {shortDateHe(t.decided_at)} · ביטחון: {conf}
                  </p>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Section: Portfolio rebalances — wires Block 9 into Block 10 */}
      {report.portfolio.rebalance_pairs > 0 ? (
        <>
          <SectionHeader
            title="העברות תקציב בין קמפיינים"
            description="פעולות §T11 — הסוכן זיהה זוג של 'קמפיין רעב לתקציב + קמפיין יקר ויציב' והעביר תקציב ביניהם."
          />
          <div className="mb-10 grid gap-3 sm:grid-cols-2">
            <KpiBox
              label="זוגות שבוצעו"
              value={report.portfolio.rebalance_pairs.toLocaleString("he-IL")}
            />
            <KpiBox
              label="סך התקציב שעבר"
              value={
                report.portfolio.moved_ils_total !== null
                  ? `₪${Math.round(report.portfolio.moved_ils_total).toLocaleString("he-IL")}/יום`
                  : "—"
              }
            />
          </div>
        </>
      ) : null}

      {/* Section: Lead Quality (Phase 8, mastery plan §11) */}
      {report.lead_quality.total_leads > 0 ? (
        <>
          <SectionHeader
            title="איכות הלידים"
            description={`הסוכן יודע לסווג קמפיין כ"מנצח" רק אחרי שהלידים שלו דורגו. ${report.lead_quality.graded_leads} מתוך ${report.lead_quality.total_leads} דורגו החודש.`}
          />
          <div className="mb-2 grid gap-3 sm:grid-cols-4">
            <KpiBox
              label="לידים החודש"
              value={report.lead_quality.total_leads.toLocaleString("he-IL")}
            />
            <KpiBox
              label="דורגו"
              value={`${report.lead_quality.graded_leads} / ${report.lead_quality.total_leads}`}
            />
            <KpiBox
              label="ציון ממוצע"
              value={
                report.lead_quality.avg_grade != null
                  ? report.lead_quality.avg_grade.toFixed(2)
                  : "—"
              }
            />
            <KpiBox
              label="פס איכות"
              value={
                {
                  high: "איכותי",
                  mixed: "מעורב",
                  low: "נמוך",
                  insufficient_data: "מעט נתונים",
                  no_leads: "אין לידים",
                }[report.lead_quality.band]
              }
            />
          </div>
          <div className="mb-10 grid grid-cols-5 gap-1 text-center text-xs">
            {(["1", "2", "3", "4", "5"] as const).map((g) => (
              <div
                key={g}
                className="rounded-md border border-border bg-card px-2 py-1"
              >
                <div className="text-muted-foreground">דירוג {g}</div>
                <div className="text-foreground">
                  {report.lead_quality.grade_distribution[g]}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Section 6: Open alerts */}
      {report.open_alerts.length > 0 ? (
        <>
          <SectionHeader
            title="התראות פתוחות"
            description="התראות שהסוכן הציע ועדיין ממתינות לאישור."
          />
          <div className="mb-10 space-y-3">
            {report.open_alerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/approvals/${alert.id}`}
                className="block rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 transition-colors hover:border-amber-500/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {alert.alert_type ?? "התראה"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    הוצעה: {shortDateHe(alert.created_at)}
                  </span>
                </div>
                {alert.message ? (
                  <p className="mt-2 text-sm leading-relaxed">{alert.message}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </Shell>
  );
}

function KpiBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "alert" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        tone === "good" && "border-emerald-500/30",
        tone === "warn" && "border-amber-500/30",
        tone === "alert" && "border-destructive/30",
        tone === "neutral" && "border-border",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-h3 tabular-nums">{value}</div>
    </div>
  );
}
