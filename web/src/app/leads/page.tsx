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
import { SyncLeadsButton } from "./sync-leads-button";
import { LeadCard } from "./lead-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "לידים" };

const TABS = [
  { filter: "ungraded", label: "ממתינים לדירוג" },
  { filter: "all", label: "הכל" },
  { filter: "graded", label: "דורגו" },
] as const;

type TabFilter = (typeof TABS)[number]["filter"];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/leads");

  const { filter: rawFilter } = await searchParams;
  const filter: TabFilter = (TABS.find((t) => t.filter === rawFilter)?.filter ??
    "ungraded") as TabFilter;

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/audiences">
        <SubNav items={AUDIENCE_GROUP_ITEMS} />
        <PageHeader eyebrow="לידים" title="לידים" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const [leads, allLeads] = await Promise.all([
    db.listLeads(business.id, filter),
    db.listLeads(business.id, "all"),
  ]);

  const counts: Record<TabFilter, number> = {
    ungraded: allLeads.filter((l) => l.latest_grade == null).length,
    all: allLeads.length,
    graded: allLeads.filter((l) => l.latest_grade != null).length,
  };

  const lastSync = allLeads[0]?.synced_at ?? null;

  return (
    <Shell active="/audiences">
      <SubNav items={AUDIENCE_GROUP_ITEMS} />
      <PageHeader
        eyebrow="לידים"
        title="לידים — דירוג איכות"
        subtitle={
          lastSync
            ? `דרג את הלידים כדי שהסוכן ידע אילו קמפיינים באמת מביאים עסקים. סנכרון אחרון: ${relativeAge(lastSync)}.`
            : 'עוד לא בוצע סנכרון לידים. לחץ "סנכרן עכשיו" כדי למשוך את הלידים מה־Meta Lead Forms.'
        }
        actions={<SyncLeadsButton />}
      />

      <div className="mb-6 flex items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t.filter}
            href={`/leads?filter=${t.filter}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              filter === t.filter
                ? "border-brand-500/50 bg-brand-500/10 text-foreground"
                : "border-border text-muted-foreground hover:border-brand-500/30 hover:text-foreground",
            )}
          >
            {t.label}
            <span className="mr-1.5 text-xs opacity-70">
              ({counts[t.filter]})
            </span>
          </Link>
        ))}
      </div>

      {leads.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין לידים בקטגוריה זו</CardTitle>
            <CardDescription>
              {filter === "ungraded" && counts.all === 0
                ? "אין לידים שמורים. לחץ \"סנכרן עכשיו\" כדי למשוך את הלידים מה־Meta Lead Forms."
                : filter === "ungraded"
                  ? "כל הלידים כבר דורגו. מעולה."
                  : "אין לידים בקטגוריה זו עדיין."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
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

function relativeAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days < 1) {
    const hours = Math.floor(ms / (3600 * 1000));
    if (hours < 1) return "ממש עכשיו";
    return `לפני ${hours} שעות`;
  }
  if (days < 30) return `לפני ${days} ימים`;
  const months = Math.floor(days / 30);
  return `לפני ${months} חודשים`;
}
