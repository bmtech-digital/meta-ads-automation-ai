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
import { DecisionRow } from "@/components/decision-row";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { AgentDecision, Approval, ApprovalStatus } from "@/lib/db/types";
import {
  TARGET_KIND_LABEL_HE,
  relativeHe,
  taskTypeLabel,
} from "@/lib/approvals-fmt";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "החלטות הסוכן" };

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

type ViewMode = "approvals" | "activity";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/history");

  const { view: viewRaw } = await searchParams;
  const view: ViewMode = viewRaw === "activity" ? "activity" : "approvals";

  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/history">
        <PageHeader eyebrow="היסטוריה" title="החלטות הסוכן" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // Fetch in parallel — both views run on every render so the tab counts are
  // accurate even when switching back and forth.
  const [approvals, activity] = await Promise.all([
    db.listHistory(business.id, DAYS),
    db.listAgentActivity(business.id, DAYS),
  ]);

  const subtitle =
    view === "approvals"
      ? `${DAYS} הימים האחרונים. ${approvals.length} רשומות לא־ממתינות.`
      : `${DAYS} הימים האחרונים. ${activity.length} החלטות שקופות של הסוכן (דילוגים, דחיות, סיווגי ניתוב).`;

  return (
    <Shell active="/history">
      <PageHeader
        eyebrow="היסטוריה"
        title="החלטות הסוכן"
        subtitle={subtitle}
      />

      <div className="mb-4 flex items-center gap-1 rounded-lg border bg-card p-1 text-sm">
        <TabLink
          href="/history?view=approvals"
          active={view === "approvals"}
          label="אישורים"
          count={approvals.length}
          description="הצעות שאישרת / דחית / בוצעו"
        />
        <TabLink
          href="/history?view=activity"
          active={view === "activity"}
          label="פעילות שקופה של הסוכן"
          count={activity.length}
          description="הסוכן בדק וקבע לא להציע, או הצעות שנחסמו ע״י guardrail"
        />
      </div>

      {view === "approvals" ? (
        <ApprovalsTable rows={approvals} />
      ) : (
        <ActivityFeed rows={activity} />
      )}
    </Shell>
  );
}

function TabLink({
  href,
  active,
  label,
  count,
  description,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  description: string;
}) {
  return (
    <Link
      href={href}
      title={description}
      className={
        "flex flex-1 items-center justify-between gap-2 rounded-md px-3 py-2 transition-colors " +
        (active
          ? "bg-brand-500/15 text-brand-700 dark:text-brand-300 font-semibold"
          : "text-muted-foreground hover:bg-muted/50")
      }
    >
      <span>{label}</span>
      <span
        className={
          "rounded-full px-2 py-0.5 text-xs " +
          (active
            ? "bg-brand-500/30 text-brand-800 dark:bg-brand-500/40 dark:text-brand-100"
            : "bg-muted text-muted-foreground")
        }
      >
        {count}
      </span>
    </Link>
  );
}

function ApprovalsTable({ rows }: { rows: Approval[] }) {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed bg-card/40">
        <CardHeader>
          <CardTitle>אין היסטוריית אישורים עדיין</CardTitle>
          <CardDescription>
            ברגע שהסוכן יציע פעולות והן יאושרו / יידחו / יבוצעו, הן יופיעו כאן.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
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
                    <div className="text-xs">{relativeHe(a.created_at)}</div>
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
  );
}

function ActivityFeed({ rows }: { rows: AgentDecision[] }) {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed bg-card/40">
        <CardHeader>
          <CardTitle>אין עדיין פעילות שקופה לתעד</CardTitle>
          <CardDescription>
            דילוגים, דחיות ע״י guardrail, וסיווגי ניתוב (§T0r) יופיעו כאן ברגע
            שהסוכן יריץ observe-propose ויתעד אותם.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-4">
        <ol className="flex flex-col gap-3">
          {rows.map((d) => (
            <DecisionRow key={d.id} d={d} showApprovalLink={true} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
