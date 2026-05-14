import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { NewCampaignForm } from "./new-campaign-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "קמפיין חדש" };

export default async function NewCampaignPage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/campaigns/new");

  const business = await getActiveBusiness();
  if (!business) {
    return (
      <Shell active="/campaigns">
        <PageHeader eyebrow="קמפיין חדש" title="קמפיין חדש" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const db = getDataClient();
  const [audiences, knowledge] = await Promise.all([
    db.listAudiences(business.id, "all"),
    db.getBusinessKnowledge(business.id),
  ]);

  // Filter Custom + Lookalike (Saved audiences can't be referenced by ID in
  // Meta's ad-set targeting the same way — they're already a targeting spec
  // baked into a Saved row).
  const usable = audiences.filter(
    (a) =>
      a.archived_at == null &&
      (a.kind === "custom" || a.kind === "lookalike") &&
      (a.approximate_count_upper_bound ?? 0) >= 100,
  );

  return (
    <Shell active="/campaigns">
      <PageHeader
        eyebrow="קמפיין חדש"
        title={`בנה קמפיין חדש ל-${business.name}`}
        subtitle="הסוכן יציע את הקמפיין שלך כ-approval. אחרי שתאשר, Meta יקבל את כל השרשרת (קמפיין + ad set + מודעה) במצב PAUSED."
      />

      <NewCampaignForm
        businessId={business.id}
        businessName={business.name}
        primaryKpi={business.primary_kpi}
        targetCplIls={business.target_cpl_ils}
        targetCpaIls={business.target_cpa_ils}
        targetRoas={business.target_roas}
        monthlyBudgetIls={business.monthly_budget_ils}
        dailyBudgetIls={business.daily_budget_ils}
        metaPageId={business.meta_page_id}
        websiteUrl={knowledge?.website_url ?? null}
        customerAgeMin={knowledge?.customer_age_min ?? null}
        customerAgeMax={knowledge?.customer_age_max ?? null}
        audiences={usable.map((a) => ({
          id: a.meta_audience_id,
          name: a.name,
          kind: a.kind,
          subtype: a.subtype,
          size_upper: a.approximate_count_upper_bound,
        }))}
      />

      <Link
        href="/campaigns"
        className="mt-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={14} />
        חזרה לקמפיינים
      </Link>
    </Shell>
  );
}
