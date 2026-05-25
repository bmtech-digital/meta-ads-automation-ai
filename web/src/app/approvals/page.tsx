import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
import { BudgetHealthCard } from "@/components/budget-health-card";
import { HistoryIcon } from "@/components/brand/icons";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { ApprovalsFilteredList } from "./approvals-filtered-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ממתינות לאישור" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const { campaign: campaignFilter } = await searchParams;
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/approvals");

  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/approvals">
        <PageHeader eyebrow="הצעות" title="ממתינות לאישור" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const pending = await db.listPendingApprovals(business.id);
  const budgetHealth = await db.getLatestBudgetHealthDecision(business.id);

  // Surface the most recent observation_blocked rows (Migration 033) so
  // operators see "agent has something to act on, gated on unblock X" as a
  // first-class part of the approvals queue — not buried inside /runs.
  const latestRuns = await db.listRunsForBusiness(business.id, {
    graphName: "observe_propose",
    limit: 1,
  });
  const latestRun = latestRuns[0] ?? null;
  const blockedFindings = latestRun
    ? (await db.listDecisionsForRun(business.id, latestRun.run_id)).filter(
        (d) => d.decision_type === "observation_blocked",
      )
    : [];

  return (
    <Shell active="/approvals">
      <PageHeader
        eyebrow="הצעות"
        title="ממתינות לאישור"
        subtitle={`ממוין לפי דחיפות ואז לפי זמן יצירה. ${pending.length} ממתינות בסה״כ.`}
        actions={
          <Link
            href="/history"
            aria-label="היסטוריית החלטות"
            title="היסטוריית החלטות"
            className="glass-surface inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <HistoryIcon size={16} />
            <span className="hidden sm:inline">היסטוריה</span>
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <BudgetHealthCard business={business} decision={budgetHealth} />

        {blockedFindings.length > 0 && latestRun ? (
          <Card>
            <CardHeader>
              <CardTitle>ממצאים שמחכים להסרת חסם</CardTitle>
              <CardDescription>
                הסוכן זיהה את הממצאים האלה בסריקה האחרונה, אבל לא יכול
                להציע פעולה עד שהחסם יוסר.{" "}
                <Link
                  href={`/runs/${latestRun.run_id}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  פתח את הריצה ↗
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {blockedFindings.map((d) => {
                const out =
                  d.outputs && typeof d.outputs === "object"
                    ? (d.outputs as Record<string, unknown>)
                    : {};
                const blockedBy = Array.isArray(out.blocked_by)
                  ? (out.blocked_by as unknown[]).filter(
                      (x): x is string => typeof x === "string",
                    )
                  : [];
                return (
                  <div
                    key={d.id}
                    className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2.5 text-[13px] dark:border-amber-900/50 dark:bg-amber-900/10"
                  >
                    <div className="font-medium">{d.summary}</div>
                    {d.rationale ? (
                      <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted-foreground">
                        {d.rationale}
                      </div>
                    ) : null}
                    {blockedBy.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {blockedBy.map((b) => (
                          <span
                            key={b}
                            className="rounded bg-amber-200 px-2 py-0.5 text-[11px] font-mono text-amber-900"
                          >
                            🔒 {b}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {pending.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>אין הצעות ממתינות</CardTitle>
              <CardDescription>
                כל ההצעות הקיימות טופלו, או שהסוכן עוד לא רץ. הפעל את ה-runner:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre
                dir="ltr"
                className="text-left font-mono text-xs text-muted-foreground"
              >
                docker compose run --rm campaigner bash
                runners/daily_observe_propose.sh
              </pre>
            </CardContent>
          </Card>
        ) : (
          <ApprovalsFilteredList
            approvals={pending}
            initialCampaignFilter={campaignFilter ?? null}
          />
        )}
      </div>
    </Shell>
  );
}
