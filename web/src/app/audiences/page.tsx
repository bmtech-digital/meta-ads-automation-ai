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
import { SubNav, AUDIENCE_GROUP_ITEMS } from "@/components/sub-nav";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { cn } from "@/lib/utils";
import { SyncAudiencesButton } from "./sync-audiences-button";
import { AudienceServiceTagSelect } from "@/components/audience-service-tag-select";
import { AudienceTargetingDetail } from "@/components/audience-targeting-detail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "קהלים" };

const TABS = [
  { kind: "all", label: "הכל" },
  { kind: "custom", label: "Custom" },
  { kind: "saved", label: "שמורים" },
  { kind: "lookalike", label: "Lookalike" },
] as const;

type TabKind = (typeof TABS)[number]["kind"];

// Hebrew labels for Meta subtype enum — operator-facing, no jargon.
const SUBTYPE_LABEL_HE: Record<string, string> = {
  WEBSITE: "מבקרי אתר",
  CUSTOMER_FILE: "קובץ לקוחות",
  LEAD_GENERATION: "טופסי לידים",
  ENGAGEMENT: "התעניינו בעמוד",
  VIDEO: "צופי וידאו",
  APP_ACTIVITY: "משתמשי אפליקציה",
  MARKETPLACE_LISTINGS: "מעורבות במרקטפלייס",
  OFFLINE_CONVERSION_FILE: "המרות אופליין",
  LOOKALIKE: "דומה",
};

function formatSize(low: number | null, up: number | null): string {
  if (low == null && up == null) return "—";
  if (low === up || up == null) return formatNumber(low ?? 0);
  if (low == null) return `עד ${formatNumber(up)}`;
  return `${formatNumber(low)}–${formatNumber(up)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function relativeAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days < 1) return "היום";
  if (days < 30) return `לפני ${days} ימים`;
  const months = Math.floor(days / 30);
  if (months < 12) return `לפני ${months} חודשים`;
  return `לפני ${Math.floor(months / 12)} שנים`;
}

export default async function AudiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/audiences");

  const { kind: rawKind } = await searchParams;
  const kind: TabKind = (TABS.find((t) => t.kind === rawKind)?.kind ??
    "all") as TabKind;

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/audiences">
        <SubNav items={AUDIENCE_GROUP_ITEMS} />
        <PageHeader eyebrow="קהלים" title="קהלים" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const audiences = await db.listAudiences(business.id, kind);
  const lastSynced = audiences[0]?.synced_at ?? null;

  // Block 13 follow-up — fetch products so the per-row dropdown can offer
  // valid service tags. Untagged audiences (synced from Meta) become
  // assignable; tagged audiences become re-assignable / clearable.
  const knowledge = await db.getBusinessKnowledge(business.id);
  const productNames = (knowledge?.products ?? [])
    .map((p) => (typeof p.name === "string" ? p.name : ""))
    .filter((s) => s.length > 0);

  // Counts for tab badges
  const all = await db.listAudiences(business.id, "all");
  const counts: Record<TabKind, number> = {
    all: all.length,
    custom: all.filter((a) => a.kind === "custom").length,
    saved: all.filter((a) => a.kind === "saved").length,
    lookalike: all.filter((a) => a.kind === "lookalike").length,
  };

  return (
    <Shell active="/audiences">
      <SubNav items={AUDIENCE_GROUP_ITEMS} />
      <PageHeader
        eyebrow="קהלים"
        title="קהלים — Custom, Saved & Lookalike"
        subtitle={
          lastSynced
            ? `מראה את הקהלים הקיימים בחשבון המטא של ${business.name}. סונכרן ${relativeAge(lastSynced)}.`
            : `מראה את הקהלים הקיימים בחשבון המטא של ${business.name}. עוד לא בוצע סנכרון — לחץ "סנכרן עכשיו".`
        }
        actions={<SyncAudiencesButton businessId={business.id} />}
      />

      <div className="mb-4 rounded-lg border border-border/60 bg-background/40 p-3 text-[12px] text-muted-foreground">
        רוצה שהסוכן יציע <strong>קהלים חדשים</strong> פר שירות (Custom / Lookalike / Saved)?
        עבור ל-
        <Link
          href="/business-knowledge"
          className="ms-1 text-primary underline-offset-2 hover:underline"
        >
          העסק שלי
        </Link>
        , גלול לכרטיס של השירות, ולחץ "הצע קהל מבוסס מחקר". ההצעות יגיעו ל-
        <Link
          href="/approvals"
          className="ms-1 text-primary underline-offset-2 hover:underline"
        >
          אישורים
        </Link>
        תוך כדקה.
      </div>

      <div className="mb-6 flex items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t.kind}
            href={`/audiences?kind=${t.kind}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              kind === t.kind
                ? "border-brand-500/50 bg-brand-500/10 text-foreground"
                : "border-border text-muted-foreground hover:border-brand-500/30 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="mr-1.5 text-xs opacity-70">({counts[t.kind]})</span>
          </Link>
        ))}
      </div>

      {audiences.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין קהלים בקטגוריה זו</CardTitle>
            <CardDescription>
              {kind === "all"
                ? "המאגר ריק. לחץ \"סנכרן עכשיו\" — הסוכן ימשוך את הקהלים שכבר קיימים בחשבון המטא שלך."
                : "אין קהלים בקטגוריה זו לעסק זה. אפשר לעבור לטאב 'הכל' או להציע יצירת קהל חדש."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {audiences.map((a) => {
            const lower = a.approximate_count_lower_bound;
            const upper = a.approximate_count_upper_bound;
            const subtypeLabel = a.subtype
              ? SUBTYPE_LABEL_HE[a.subtype] ?? a.subtype
              : null;
            return (
              <div
                key={a.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-h3 truncate">{a.name}</h3>
                    {subtypeLabel ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {subtypeLabel}
                        {a.retention_days ? ` · נשמר ${a.retention_days} ימים` : ""}
                      </p>
                    ) : null}
                    {a.targeting_summary ? (
                      <p className="mt-1 text-xs text-foreground/80 line-clamp-2 sm:hidden">
                        {a.targeting_summary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        a.kind === "custom" &&
                          "bg-emerald-500/10 text-emerald-500",
                        a.kind === "saved" && "bg-sky-500/10 text-sky-500",
                        a.kind === "lookalike" &&
                          "bg-violet-500/10 text-violet-500",
                        a.kind === "special_ad" &&
                          "bg-amber-500/10 text-amber-500",
                      )}
                    >
                      {a.kind === "custom"
                        ? "Custom"
                        : a.kind === "saved"
                          ? "שמור"
                          : a.kind === "lookalike"
                            ? "Lookalike"
                            : "Special"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      גודל: {formatSize(lower, upper)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    מיועד לשירות:
                  </span>
                  {productNames.length > 0 ? (
                    <AudienceServiceTagSelect
                      audienceId={a.id}
                      currentTag={a.service_tag}
                      productNames={productNames}
                    />
                  ) : a.service_tag ? (
                    <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                      {a.service_tag}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/60">
                      ללא תיוג (הוסף שירותים ב-/business-knowledge כדי לתייג)
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>נוצר: {relativeAge(a.time_created)}</span>
                  {a.kind === "lookalike" && a.origin_audience_id ? (
                    <span>מבוסס על: {a.origin_audience_id}</span>
                  ) : null}
                  <span>סונכרן: {relativeAge(a.synced_at)}</span>
                  {a.delivery_status &&
                  typeof a.delivery_status === "object" &&
                  "description" in (a.delivery_status as object) ? (
                    <span className="col-span-2 truncate">
                      {String(
                        (a.delivery_status as { description?: unknown })
                          .description ?? "",
                      )}
                    </span>
                  ) : null}
                </div>

                {/* Full saved-audience targeting (migration 030) —
                    geo / age / gender / interests / behaviors / exclusions.
                    Renders nothing for custom + lookalike rows. */}
                <AudienceTargetingDetail row={a} />
              </div>
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
