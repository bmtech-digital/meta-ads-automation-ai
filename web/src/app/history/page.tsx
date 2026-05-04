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
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { ApprovalStatus } from "@/lib/db/types";
import {
  TARGET_KIND_LABEL_HE,
  relativeHe,
  taskTypeLabel,
} from "@/lib/approvals-fmt";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  executed:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  failed: "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100",
  expired: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  dry_run:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
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
      <Shell active="/history">
        <PageHeader eyebrow="היסטוריה" title="היסטוריית החלטות" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const rows = await db.listHistory(business.id, DAYS);

  return (
    <Shell active="/history">
      <PageHeader
        eyebrow="היסטוריה"
        title="היסטוריית החלטות"
        subtitle={`${DAYS} הימים האחרונים. ${rows.length} רשומות לא־ממתינות.`}
      />

      {rows.length === 0 ? (
        <Card className="border-dashed bg-card/40">
          <CardHeader>
            <CardTitle>אין היסטוריה עדיין</CardTitle>
            <CardDescription>
              ברגע שהסוכן יריץ {DAYS} יום של observe-propose, הרשומות יופיעו
              כאן.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium">תאריך</th>
                    <th className="px-4 py-3 text-right font-medium">סוג</th>
                    <th className="px-4 py-3 text-right font-medium">יעד</th>
                    <th className="px-4 py-3 text-right font-medium">סטטוס</th>
                    <th className="px-4 py-3 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                        {new Date(a.created_at).toLocaleDateString("he-IL")}
                        <div className="text-xs">
                          {relativeHe(a.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {taskTypeLabel(a.task_type)}
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[a.status]}`}
                        >
                          {STATUS_LABEL_HE[a.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left">
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
            </div>
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}
