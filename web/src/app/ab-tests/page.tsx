import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { SubNav, CAMPAIGN_GROUP_ITEMS } from "@/components/sub-nav";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { shortDateHe } from "@/lib/report-fmt";
import {
  AB_TEST_STATUS_LABEL_HE,
  AB_TEST_STATUS_STYLES,
  AB_TEST_METRIC_LABEL_HE,
  daysRemainingHe,
} from "@/lib/ab-tests-fmt";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "מבחני A/B" };

const TABS = [
  { mode: "running", label: "פעילים" },
  { mode: "ready_to_decide", label: "מוכנים להחלטה" },
  { mode: "decided", label: "אחרונים" },
] as const;

type Mode = (typeof TABS)[number]["mode"];

export default async function AbTestsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/ab-tests");

  const { mode: rawMode } = await searchParams;
  const mode: Mode = (TABS.find((t) => t.mode === rawMode)?.mode ??
    "running") as Mode;

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/campaigns">
        <SubNav items={CAMPAIGN_GROUP_ITEMS} />
        <PageHeader eyebrow="מבחני A/B" title="מבחני A/B" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const tests = await db.listAbTests(business.id, mode);

  return (
    <Shell active="/campaigns">
      <SubNav items={CAMPAIGN_GROUP_ITEMS} />
      <PageHeader
        eyebrow="מבחני A/B"
        title="מבחני A/B"
        subtitle={`השוואות פורמליות בין וריאנטי קריאייטיב. הסוכן רושם תוצאות כל ${tests.length === 1 ? "מבחן" : "מבחן"} — מטא ממשיכה לחלק תקציב לבד.`}
      />

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t.mode}
            href={`/ab-tests?mode=${t.mode}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              mode === t.mode
                ? "border-brand-500/50 bg-brand-500/10 text-foreground"
                : "border-border text-muted-foreground hover:border-brand-500/30 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tests.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין מבחנים בקטגוריה זו</CardTitle>
            <CardDescription>
              {mode === "running" &&
                "אין מבחנים פעילים כרגע. הסוכן יציע מבחן חדש כשיש 2-4 קריאייטיבים שכדאי להשוות ביניהם."}
              {mode === "ready_to_decide" &&
                "אין מבחנים שמוכנים להחלטה. החלון של 7+ ימים עוד לא נסגר על אף אחד מהמבחנים הפעילים."}
              {mode === "decided" &&
                "אין מבחנים שהוחלטו בחודש האחרון."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {tests.map((t) => {
            const isReady =
              t.status === "running" && new Date(t.planned_end_at) <= new Date();
            return (
              <Link
                key={t.id}
                href={`/ab-tests/${t.id}`}
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-h3 truncate">{t.test_name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      מטריקה: {AB_TEST_METRIC_LABEL_HE[t.winner_metric]} ·{" "}
                      {t.variants.length} וריאנטים
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        AB_TEST_STATUS_STYLES[t.status],
                      )}
                    >
                      {AB_TEST_STATUS_LABEL_HE[t.status]}
                    </span>
                    {isReady ? (
                      <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-500">
                        מוכן להחלטה
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>התחיל: {shortDateHe(t.started_at)}</span>
                  <span>
                    {t.status === "running"
                      ? daysRemainingHe(t.planned_end_at)
                      : `מסתיים: ${shortDateHe(t.planned_end_at)}`}
                  </span>
                  {t.decided_at ? (
                    <span>הוחלט: {shortDateHe(t.decided_at)}</span>
                  ) : null}
                  {t.winner_creative_id ? (
                    <span className="text-foreground">
                      ניצח:{" "}
                      {
                        t.variants.find(
                          (v) => v.creative_id === t.winner_creative_id,
                        )?.variant_label
                      }
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <SectionHeader title="" />
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={14} />
        חזרה לדשבורד
      </Link>
    </Shell>
  );
}
