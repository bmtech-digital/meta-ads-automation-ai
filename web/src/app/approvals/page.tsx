import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  TARGET_KIND_LABEL_HE,
  formatExpectedImpact,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
  truncate,
} from "@/lib/approvals-fmt";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
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

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Nav active="/approvals" />

        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">הצעות ממתינות</h1>
            <p className="text-sm text-muted-foreground">
              ממוין לפי דחיפות ואז לפי זמן יצירה. {pending.length} ממתינות.
            </p>
          </div>
        </header>

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
          <div className="flex flex-col gap-4">
            {pending.map((a) => {
              const hrReason = requiresHumanReview(a);
              const impact = formatExpectedImpact(a.expected_impact);
              const targetLabel = a.target_kind ? TARGET_KIND_LABEL_HE[a.target_kind] : "";
              return (
                <Card
                  key={a.id}
                  className={hrReason ? "border-amber-500 border-2" : ""}
                >
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[a.urgency]}`}
                          >
                            {URGENCY_LABEL_HE[a.urgency]}
                          </span>
                          <span className="font-semibold">{taskTypeLabel(a.task_type)}</span>
                          {targetLabel && a.target_id ? (
                            <span className="text-sm text-muted-foreground">
                              {targetLabel}: <span dir="ltr" className="font-mono text-xs">{a.target_id}</span>
                            </span>
                          ) : null}
                        </div>
                        {hrReason ? (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
                            ⚠️ דורש בדיקה: {hrReason}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">{relativeHe(a.created_at)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm">{truncate(a.rationale)}</p>
                    {impact ? (
                      <div className="rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="text-muted-foreground">השפעה צפויה: </span>
                        <span className="font-semibold">{impact}</span>
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <Link href={`/approvals/${a.id}`}>
                        <Button>פתח וסקור</Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
