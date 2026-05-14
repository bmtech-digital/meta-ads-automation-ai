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
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { relativeHe } from "@/lib/approvals-fmt";
import type { PlanCarryoverRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "תוכניות פתוחות" };

const TARGET_KIND_HE: Record<string, string> = {
  campaign: "קמפיין",
  adset: "קבוצת מודעות",
  ad: "מודעה",
  creative: "קריאייטיב",
  account: "חשבון",
};

function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((target - now) / 86_400_000));
}

export default async function PlansPage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/plans");

  const db = getDataClient();
  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/plans">
        <PageHeader
          eyebrow="תוכניות"
          title="תוכניות פתוחות"
          subtitle="לא נמצא עסק פעיל."
        />
      </Shell>
    );
  }

  const plans = await db.listActivePlans(business.id);

  // Group by target_id so a campaign with 2 forward-steps appears in one card.
  const byTarget: Record<string, typeof plans> = {};
  for (const p of plans) {
    const key = `${p.target_kind ?? "account"}:${p.target_id ?? "-"}`;
    if (!byTarget[key]) byTarget[key] = [];
    byTarget[key].push(p);
  }
  const groups = Object.entries(byTarget);

  return (
    <Shell active="/plans">
      <PageHeader
        eyebrow="תוכניות"
        title="תוכניות פתוחות"
        subtitle={`${plans.length} צעדים פתוחים שהסוכן התחייב אליהם ועוקב.`}
      />

      {groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין תוכניות פתוחות</CardTitle>
            <CardDescription>
              כל פעם שאתה מאשר הצעה עם &quot;תוכנית:&quot; של 2-3 צעדים ברציונל, הצעדים
              הצופים פני עתיד נשמרים כאן. הסוכן בודק אותם בכל ריצה ומציע את
              הצעד הבא כשהתנאי שקבע מתקיים. בריצות הקרובות תראה כאן תוכניות
              ככל שהצעות חדשות יאושרו.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([key, steps]) => {
            const first = steps[0];
            const targetKind = first.target_kind ?? "account";
            const targetLabel = TARGET_KIND_HE[targetKind] ?? targetKind;
            const expiresIn = daysUntil(first.expires_at);
            return (
              <Card key={key}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-base">
                        {targetLabel}
                        {first.target_id ? (
                          <>
                            {": "}
                            <span dir="ltr" className="font-mono text-xs">
                              {first.target_id}
                            </span>
                          </>
                        ) : null}
                      </CardTitle>
                      <CardDescription>
                        {steps.length} צעד{steps.length > 1 ? "ים פתוחים" : " פתוח"}
                        {first.source_task_type
                          ? ` · ממקור: ${first.source_task_type}`
                          : null}
                      </CardDescription>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      פג תוקף בעוד {expiresIn} {expiresIn === 1 ? "יום" : "ימים"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {steps.map((s: PlanCarryoverRow) => (
                    <div
                      key={s.id}
                      className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-muted-foreground">
                          שלב {s.step_order}
                        </span>
                        <span className="text-sm">{s.action_text}</span>
                      </div>
                      {s.trigger_condition ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          תנאי הפעלה: {s.trigger_condition}
                        </div>
                      ) : null}
                      <div className="mt-2 text-xs text-muted-foreground">
                        התחייבות מ-{relativeHe(s.committed_at)}
                        {s.source_approval_id ? (
                          <>
                            {" · "}
                            <Link
                              href={`/approvals/${s.source_approval_id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              ההצעה המקורית
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
