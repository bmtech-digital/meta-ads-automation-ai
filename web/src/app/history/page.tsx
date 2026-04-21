import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { ApprovalStatus } from "@/lib/db/types";
import { TARGET_KIND_LABEL_HE, relativeHe, taskTypeLabel } from "@/lib/approvals-fmt";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: "bg-slate-200 text-slate-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  executed: "bg-green-100 text-green-800",
  failed: "bg-red-200 text-red-900",
  expired: "bg-gray-200 text-gray-700",
  dry_run: "bg-purple-100 text-purple-800",
};

const STATUS_LABEL_HE: Record<ApprovalStatus, string> = {
  pending: "ממתין",
  approved: "אושר",
  rejected: "נדחה",
  executed: "בוצע",
  failed: "נכשל",
  expired: "פג תוקף",
  dry_run: "Dry run",
};

const DAYS = 30;

export default async function HistoryPage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/history");

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-4xl">
          <Nav active="/history" />
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

  const rows = await db.listHistory(business.id, DAYS);

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Nav active="/history" />

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">היסטוריית החלטות</h1>
          <p className="text-sm text-muted-foreground">
            {DAYS} הימים האחרונים. {rows.length} רשומות לא-ממתינות.
          </p>
        </header>

        {rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>אין היסטוריה עדיין</CardTitle>
              <CardDescription>
                ברגע שהסוכן יריץ {DAYS} יום של observe-propose, הרשומות יופיעו כאן.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-right">תאריך</th>
                    <th className="p-3 text-right">סוג</th>
                    <th className="p-3 text-right">יעד</th>
                    <th className="p-3 text-right">סטטוס</th>
                    <th className="p-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-3 whitespace-nowrap text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("he-IL")}
                        <div className="text-xs">{relativeHe(a.created_at)}</div>
                      </td>
                      <td className="p-3">{taskTypeLabel(a.task_type)}</td>
                      <td className="p-3">
                        {a.target_kind ? (
                          <>
                            <span className="text-xs text-muted-foreground">
                              {TARGET_KIND_LABEL_HE[a.target_kind]}:
                            </span>{" "}
                            <span dir="ltr" className="font-mono text-xs">
                              {a.target_id ?? "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[a.status]}`}
                        >
                          {STATUS_LABEL_HE[a.status]}
                        </span>
                      </td>
                      <td className="p-3 text-left">
                        <Link
                          href={`/approvals/${a.id}`}
                          className="text-sm text-primary underline-offset-2 hover:underline"
                        >
                          פתח
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
