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
