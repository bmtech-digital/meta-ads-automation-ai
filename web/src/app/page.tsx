import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Pencil } from "lucide-react";
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { PulseDot } from "@/components/brand/icons";
import { RunNowButton } from "@/components/run-now-button";
import { BudgetHealthCard } from "@/components/budget-health-card";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  TARGET_KIND_LABEL_HE,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
  truncate,
} from "@/lib/approvals-fmt";
import type { Approval, Business, Heartbeat, HeartbeatFlow } from "@/lib/db/types";
import {
  isTokenActionable,
  tokenExpiryState,
  tokenStateLabelHe,
  tokenStateStyles,
} from "@/lib/token-expiry";

const INBOX_PREVIEW_LIMIT = 5;

const FLOWS: Array<{ flow: HeartbeatFlow; label: string; schedule: string }> = [
  { flow: "daily_observe_propose", label: "סריקה יומית", schedule: "כל יום 09:00" },
  { flow: "execute_approvals", label: "ביצוע אישורים", schedule: "כל 15 דק׳" },
  { flow: "weekly_creative_firehose", label: "ייצור קריאייטיבים", schedule: "שני 10:00" },
];

type PhaseMeta = {
  label: string;
  tone: "active" | "idle" | "error" | "success";
  cls: string;
};

function phaseMeta(hb: Heartbeat | undefined): PhaseMeta {
  if (!hb) return { label: "עוד לא רץ", tone: "idle", cls: "text-muted-foreground" };
  if (hb.phase === "end")
    return { label: "הצלחה", tone: "success", cls: "text-success" };
  if (hb.phase === "error")
    return { label: "נכשל", tone: "error", cls: "text-destructive" };
  return { label: "רץ עכשיו", tone: "active", cls: "text-brand-500 dark:text-brand-400" };
}

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await getAuth().signOut();
  redirect("/login");
}

export default async function HomePage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login");

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  const heartbeats = business ? await db.getLatestHeartbeats(business.id) : [];
  const byFlow = new Map(heartbeats.map((h) => [h.flow, h]));
  const allowLocalRunners = process.env.NODE_ENV !== "production";
  const pendingApprovals = business ? await db.listPendingApprovals(business.id) : [];
  const inboxPreview = pendingApprovals.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxRemainder = Math.max(0, pendingApprovals.length - inboxPreview.length);
  const budgetHealth = business ? await db.getLatestBudgetHealthDecision(business.id) : null;

  const right = (
    <form action={signOutAction} className="flex items-center gap-2">
      <span className="hidden md:inline text-xs text-muted-foreground">{session.email}</span>
      <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
        <LogOut size={14} />
        התנתק
      </Button>
    </form>
  );

  return (
    <Shell active="/" right={right}>
      <PageHeader
        eyebrow="דשבורד"
        title={business ? business.name : "Campaigner"}
        subtitle="הסוכן סורק, מציע, ומבצע רק אחרי שאתה מאשר. כל מה שצריך לקרות היום — מופיע כאן."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border bg-muted/40 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              DB · {db.mode}
            </Badge>
            <Badge variant="outline" className="border-border bg-muted/40 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              AUTH · {auth.mode}
            </Badge>
          </div>
        }
      />

      {business ? (
        <div className="flex flex-col gap-10">
          <TokenExpiryBanner business={business} />

          <BudgetHealthCard business={business} decision={budgetHealth} />

          <ApprovalsInbox
            preview={inboxPreview}
            total={pendingApprovals.length}
            remainder={inboxRemainder}
          />

          <section>
            <SectionHeader
              title="בריף העסק"
              description="הקלט שהסוכן קורא לפני כל ריצה. שינויים כאן משפיעים על סריקת הבוקר."
              action={
                <Link href="/settings">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Pencil size={14} />
                    ערוך
                  </Button>
                </Link>
              }
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <KpiTile
                label="תקציב פרסום חודשי"
                value={business.monthly_budget_ils ? `₪${Number(business.monthly_budget_ils).toLocaleString("he-IL")}` : "—"}
                hint={business.monthly_budget_ils ? "מוגדר ב-Business" : "לא הוגדר"}
                accent={!!business.monthly_budget_ils}
              />
              <KpiTile
                label="תקציב יומי (מחושב)"
                value={
                  business.monthly_budget_ils
                    ? `≈ ₪${Math.round(Number(business.monthly_budget_ils) / 30).toLocaleString("he-IL")}`
                    : "—"
                }
                hint="חודשי ÷ 30"
              />
              <KpiTile
                label="KPI עיקרי"
                value={(business.primary_kpi ?? "—").toString().toUpperCase()}
                hint="נגזר מה-vertical"
              />
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-y-2.5 gap-x-8 rounded-lg border border-border bg-card/40 p-4 text-[13px] sm:grid-cols-[auto_1fr]">
              <MetaRow label="חשבון Meta" value={business.meta_ad_account_id} />
              <MetaRow label="Page ID" value={business.meta_page_id} />
              <MetaRow label="מזהה עסק" value={business.id} />
              <TokenRow business={business} />
            </dl>
          </section>

          <section>
            <SectionHeader
              title="סריקה אחרונה"
              description="כל runner כותב heartbeat ל-Supabase בכל start / end / error. אם משהו לא התחדש מעל ״הצפוי״ — יש בעיה."
            />
            <ul className="divide-y divide-border rounded-lg border border-border bg-card/40">
              {FLOWS.map(({ flow, label, schedule }) => {
                const hb = byFlow.get(flow);
                const meta = phaseMeta(hb);
                return (
                  <li
                    key={flow}
                    className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/30"
                  >
                    <PulseDot tone={meta.tone} className={meta.tone === "active" ? "animate-pulse-soft" : ""} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{schedule}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-tabular text-xs text-muted-foreground">
                        {hb ? relativeHe(hb.ran_at) : "—"}
                      </span>
                      <span className={`text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                      {allowLocalRunners ? <RunNowButton flow={flow} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : (
        <EmptyBusinessState />
      )}
    </Shell>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mono-ltr text-[12.5px] text-foreground/90">{value}</dd>
    </>
  );
}

function TokenRow({ business }: { business: Business }) {
  const state = tokenExpiryState(business);
  return (
    <>
      <dt className="text-muted-foreground">טוקן Meta</dt>
      <dd className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-[1px] text-[11.5px] font-medium ${tokenStateStyles(state)}`}
        >
          {tokenStateLabelHe(state)}
        </span>
        <Link
          href="/settings"
          className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          נהל
        </Link>
      </dd>
    </>
  );
}

function TokenExpiryBanner({ business }: { business: Business }) {
  const state = tokenExpiryState(business);
  if (!isTokenActionable(state)) return null;
  const isExpired = state.kind === "expired" || state.kind === "critical";
  return (
    <div
      role="alert"
      className={
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm " +
        tokenStateStyles(state)
      }
    >
      <div className="flex items-center gap-2 font-medium">
        <span aria-hidden>{isExpired ? "🚨" : "⚠️"}</span>
        <span>
          {state.kind === "expired"
            ? `הטוקן של Meta פג לפני ${state.daysAgo} ימים — הביצועים והסריקות ייכשלו עד שתחדש.`
            : state.kind === "critical"
              ? state.daysLeft === 0
                ? "הטוקן של Meta פג היום. חדש עכשיו כדי שהסריקה של מחר תעבוד."
                : `הטוקן של Meta פג בעוד ${state.daysLeft} ימים — חדש עכשיו.`
              : state.kind === "warning"
                ? `הטוקן של Meta פג בעוד ${state.daysLeft} ימים.`
                : null}
        </span>
      </div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 rounded-md border border-current/30 bg-background/60 px-3 py-1 text-xs font-semibold hover:bg-background"
      >
        עבור להגדרות
        <ArrowLeft size={12} />
      </Link>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {accent ? (
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400" aria-hidden />
        ) : null}
      </div>
      <div className="mt-2 font-tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function EmptyBusinessState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
      <h2 className="text-h2">אין עסק פעיל ב-DB</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        הרץ{" "}
        <code className="mono-ltr rounded bg-muted px-1.5 py-0.5 text-[12px]">
          bash scripts/bootstrap_local_db.sh
        </code>{" "}
        כדי להריץ migrations ולטעון seed.
      </p>
    </div>
  );
}

function ApprovalsInbox({
  preview,
  total,
  remainder,
}: {
  preview: Approval[];
  total: number;
  remainder: number;
}) {
  if (total === 0) {
    return (
      <section>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/40 p-5">
          <div className="flex items-center gap-3">
            <PulseDot tone="idle" />
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">התור ריק</span>
              <span className="text-[13px] text-muted-foreground">
                אין הצעות פתוחות. הסוכן יציע משימות חדשות בסריקה הבאה.
              </span>
            </div>
          </div>
          <Link
            href="/approvals"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            כל ההצעות
            <ArrowLeft size={14} />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            משימות ממתינות לאישור
            <span className="font-tabular inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-brand-500/15 px-1.5 text-[11.5px] font-semibold text-brand-500 ring-1 ring-brand-500/30 dark:text-brand-400">
              {total}
            </span>
          </span>
        }
        description="ממוין לפי דחיפות. פתח שורה לנימוק מלא, השפעה צפויה, ולאישור/דחייה."
        action={
          <Link href="/approvals">
            <Button variant="outline" size="sm" className="gap-1">
              כל ההצעות
              <ArrowLeft size={14} />
            </Button>
          </Link>
        }
      />
      <ul className="overflow-hidden rounded-lg border border-border bg-card/40">
        {preview.map((a, i) => {
          const hrReason = requiresHumanReview(a);
          const targetLabel = a.target_kind ? TARGET_KIND_LABEL_HE[a.target_kind] : "";
          return (
            <li key={a.id} className={i > 0 ? "border-t border-border" : ""}>
              <Link
                href={`/approvals/${a.id}`}
                className="group flex flex-col gap-2 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-semibold ${URGENCY_STYLES[a.urgency]}`}
                  >
                    {URGENCY_LABEL_HE[a.urgency]}
                  </span>
                  <span className="text-[14px] font-semibold">{taskTypeLabel(a.task_type)}</span>
                  {targetLabel && a.target_id ? (
                    <span className="text-[12px] text-muted-foreground">
                      {targetLabel}:{" "}
                      <span className="mono-ltr text-[11.5px]">{a.target_id}</span>
                    </span>
                  ) : null}
                  {hrReason ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-[1px] text-[11px] font-semibold text-warning ring-1 ring-warning/30">
                      דורש בדיקה
                    </span>
                  ) : null}
                  <span className="ms-auto font-tabular text-[11.5px] text-muted-foreground">
                    {relativeHe(a.created_at)}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground group-hover:text-foreground/90">
                  {truncate(a.rationale, 180)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {remainder > 0 ? (
        <div className="mt-3 text-center">
          <Link
            href="/approvals"
            className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ועוד {remainder} ממתינות
          </Link>
        </div>
      ) : null}
    </section>
  );
}
