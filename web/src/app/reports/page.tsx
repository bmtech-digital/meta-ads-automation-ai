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
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { monthLabelHe } from "@/lib/report-fmt";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "דוחות חודשיים" };

/**
 * /reports — index page. Lists months that have agent activity for the
 * active business, newest first. Block 10 (2026-05-13).
 *
 * Each link goes to /reports/[month] for the full report.
 */
export default async function ReportsIndexPage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/reports");

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/reports">
        <PageHeader eyebrow="דוחות" title="דוחות חודשיים" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
            <CardDescription>
              בחר עסק בתפריט העליון או הרץ migrations + seed כדי שיהיו נתונים.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const months = await db.listReportableMonths(business.id, 24);

  // Always include current month at the top, even if no activity yet —
  // operator may want to see "month in progress" rather than wait for first decision.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ordered = months.includes(currentMonth)
    ? months
    : [currentMonth, ...months];

  return (
    <Shell active="/reports">
      <PageHeader
        eyebrow="דוחות"
        title="דוחות חודשיים"
        subtitle={`סיכום פעילות הסוכן עבור ${business.name} — לחץ על חודש כדי לפתוח את הדוח המלא.`}
      />
      <SectionHeader title="חודשים זמינים" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((month) => {
          const isCurrent = month === currentMonth;
          return (
            <Link
              key={month}
              href={`/reports/${month}`}
              className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-h2">{monthLabelHe(month)}</span>
                {isCurrent ? (
                  <span className="text-xs font-medium text-brand-500">
                    חודש נוכחי
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                סיכום פעילות + מה הסוכן הציע ובוצע
              </p>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}
