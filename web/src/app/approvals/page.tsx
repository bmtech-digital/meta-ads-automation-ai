import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { BudgetHealthCard } from "@/components/budget-health-card";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { ApprovalsFilteredList } from "./approvals-filtered-list";

export const dynamic = "force-dynamic";

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
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-4xl">
          <Nav active="/approvals" />
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>אין עסק ב-DB</CardTitle>
              <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  const pending = await db.listPendingApprovals(business.id);
  const budgetHealth = await db.getLatestBudgetHealthDecision(business.id);

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Nav active="/approvals" />

        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">הצעות ממתינות</h1>
            <p className="text-sm text-muted-foreground">
              ממוין לפי דחיפות ואז לפי זמן יצירה. {pending.length} ממתינות בסה״כ.
            </p>
          </div>
        </header>

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
              <pre dir="ltr" className="text-left font-mono text-xs text-muted-foreground">
                docker compose run --rm campaigner bash runners/daily_observe_propose.sh
              </pre>
            </CardContent>
          </Card>
        ) : (
          <ApprovalsFilteredList approvals={pending} initialCampaignFilter={campaignFilter ?? null} />
        )}
      </div>
    </main>
  );
}
