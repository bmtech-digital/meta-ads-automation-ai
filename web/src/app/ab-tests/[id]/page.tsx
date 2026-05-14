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
import { shortDateHe } from "@/lib/report-fmt";
import {
  AB_TEST_STATUS_LABEL_HE,
  AB_TEST_STATUS_STYLES,
  AB_TEST_METRIC_LABEL_HE,
  AB_TEST_CONFIDENCE_LABEL_HE,
  AB_TEST_CONFIDENCE_TONE,
  daysRemainingHe,
  formatMetricValueHe,
} from "@/lib/ab-tests-fmt";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return { title: "מבחן A/B" };
}

interface CreativeSnapshot {
  variant_label: string;
  creative_id: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
  conversions?: number;
  video_3s_views?: number;
  metric_value?: number | null;
}

export default async function AbTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/ab-tests/${id}`);

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/ab-tests">
        <PageHeader eyebrow="מבחני A/B" title="—" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const test = await db.getAbTestById(id, business.id);
  if (!test) notFound();

  const snapshot = (test.decision_snapshot ?? {}) as Record<string, unknown>;
  const snapCreatives = (snapshot.creatives as CreativeSnapshot[] | undefined) ?? [];
  const winnerBlock = snapshot.winner as
    | { variant_label?: string; vs_runner_up_pct?: number; metric_value?: number }
    | undefined;
  const confidence = (snapshot.confidence as string | undefined) ?? "insufficient";
  const isReady =
    test.status === "running" && new Date(test.planned_end_at) <= new Date();

  return (
    <Shell active="/ab-tests">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/ab-tests" className="hover:text-foreground">
          מבחני A/B
        </Link>
        <ChevronRight size={14} className="opacity-50" />
        <span className="text-foreground">{test.test_name}</span>
      </nav>

      <PageHeader
        eyebrow={`מבחן A/B · ${test.variants.length} וריאנטים`}
        title={test.test_name}
        subtitle={`מטריקת ניצחון: ${AB_TEST_METRIC_LABEL_HE[test.winner_metric]} · התחיל ${shortDateHe(test.started_at)}`}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium",
                AB_TEST_STATUS_STYLES[test.status],
              )}
            >
              {AB_TEST_STATUS_LABEL_HE[test.status]}
            </span>
            {isReady ? (
              <span className="rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-500">
                מוכן להחלטה
              </span>
            ) : null}
          </div>
        }
      />

      {/* Test metadata */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">פרטי המבחן</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Pair label="קמפיין">{test.campaign_id}</Pair>
            <Pair label="Ad set">{test.adset_id}</Pair>
            <Pair label="התחיל">{shortDateHe(test.started_at)}</Pair>
            <Pair label={test.status === "running" ? "מצב חלון" : "תאריך סיום מתוכנן"}>
              {test.status === "running"
                ? daysRemainingHe(test.planned_end_at)
                : shortDateHe(test.planned_end_at)}
            </Pair>
            {test.decided_at ? (
              <Pair label="הוחלט בתאריך">{shortDateHe(test.decided_at)}</Pair>
            ) : null}
            {test.winner_creative_id ? (
              <Pair label="וריאנט זוכה">
                {
                  test.variants.find(
                    (v) => v.creative_id === test.winner_creative_id,
                  )?.variant_label
                }
              </Pair>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Variants */}
      <SectionHeader
        title="וריאנטים"
        description={
          test.status === "decided" || test.status === "cancelled"
            ? "ה-snapshot בו השתמשנו כדי להחליט. המספרים מקובעים לרגע ההחלטה."
            : "המבחן עוד רץ — הנתונים כאן מתעדכנים כשהסוכן מריץ evaluate_ab_test."
        }
      />
      <div className="mb-8 space-y-3">
        {test.variants.map((v) => {
          const snap = snapCreatives.find(
            (s) => s.variant_label === v.variant_label,
          );
          const isWinner = test.winner_creative_id === v.creative_id;
          return (
            <div
              key={v.creative_id}
              className={cn(
                "rounded-xl border p-4",
                isWinner
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-h3">וריאנט {v.variant_label}</span>
                  {isWinner ? (
                    <span className="ms-3 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      ניצח
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  ID: {v.creative_id}
                </span>
              </div>
              {snap ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Metric
                    label={AB_TEST_METRIC_LABEL_HE[test.winner_metric]}
                    value={formatMetricValueHe(
                      test.winner_metric,
                      snap.metric_value ?? null,
                    )}
                    primary
                  />
                  <Metric
                    label="חשיפות"
                    value={(snap.impressions ?? 0).toLocaleString("he-IL")}
                  />
                  <Metric
                    label="קליקים"
                    value={(snap.clicks ?? 0).toLocaleString("he-IL")}
                  />
                  <Metric
                    label="הוצאה"
                    value={`₪${Math.round(snap.spend ?? 0).toLocaleString("he-IL")}`}
                  />
                  <Metric
                    label="המרות"
                    value={Math.round(snap.conversions ?? 0).toLocaleString(
                      "he-IL",
                    )}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  אין עדיין snapshot — הסוכן יחשב את המדידות באבחנה הבאה.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Decision */}
      {(test.status === "decided" || test.status === "cancelled") && (
        <>
          <SectionHeader title="ההחלטה" />
          <Card className="mb-8">
            <CardContent className="space-y-3 pt-6">
              {test.status === "cancelled" ? (
                <p className="text-sm">
                  המבחן בוטל — לא הוכרז וריאנט מנצח.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">רמת ביטחון:</span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        AB_TEST_CONFIDENCE_TONE[confidence] === "good" &&
                          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                        AB_TEST_CONFIDENCE_TONE[confidence] === "warn" &&
                          "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        AB_TEST_CONFIDENCE_TONE[confidence] === "alert" &&
                          "bg-destructive/15 text-destructive",
                      )}
                    >
                      {AB_TEST_CONFIDENCE_LABEL_HE[confidence] ?? confidence}
                    </span>
                    {winnerBlock?.vs_runner_up_pct !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        פער מול הסגן: {winnerBlock.vs_runner_up_pct.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  {test.decision_reason ? (
                    <p className="text-sm leading-relaxed">
                      {test.decision_reason}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Footer note */}
      <Card className="bg-muted/40">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">משמעת Andromeda:</strong>{" "}
            המבחן הזה הוא <em>תיעוד</em> של מה ש-Meta עשתה בעצמה — לא חלוקת
            תקציב 50/50 מאולצת. אם תרצה להעמיק את הוריאנט הזוכה, צריך הצעה
            נפרדת של <code>scale_up</code> (וזה יעבור את כל הגארדריילים כרגיל).
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/50 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  primary = false,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 tabular-nums",
          primary ? "text-h3" : "text-sm font-semibold",
        )}
      >
        {value}
      </div>
    </div>
  );
}
