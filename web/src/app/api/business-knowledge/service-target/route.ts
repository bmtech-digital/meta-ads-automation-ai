import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";
import type {
  BusinessKnowledgeUpsert,
  Product,
  ProductKpiTarget,
} from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  service_name: z.string().min(1),
  value: z.number().positive(),
  kind: z.enum(["cpa", "cpl", "roas"]),
  /** "manual" when operator types; "derived_from_research" when "use research average" CTA. */
  source: z.enum(["manual", "derived_from_research"]).default("manual"),
});

/**
 * POST /api/business-knowledge/service-target
 *   body: { service_name, value, kind, source? }
 *
 * Sets a per-service KPI target on `product.kpi_target` jsonb. Distinct
 * from the business-level `businesses.target_cpl_ils` — when a campaign
 * matches this service (via §T-2 campaign-name anchoring), the agent
 * compares performance against THIS target instead of the business-wide one.
 *
 * No migration needed — products is jsonb. Operator typing a target on the
 * service-hub card triggers this endpoint; the agent's `derived_from_research`
 * variant fires when the operator clicks "השתמש בממוצע המחקר כיעד".
 */
export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const business = await getActiveBusiness();
  if (!business)
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: parsed.error.message },
      { status: 400 },
    );
  }
  const { service_name, value, kind, source } = parsed.data;

  const db = getDataClient();
  const current = await db.getBusinessKnowledge(business.id);
  if (!current) {
    return NextResponse.json(
      { error: "no_business_knowledge" },
      { status: 400 },
    );
  }

  const products = current.products ?? [];
  const idx = products.findIndex(
    (p) => p.name.trim().toLowerCase() === service_name.trim().toLowerCase(),
  );
  if (idx === -1) {
    return NextResponse.json(
      { error: "service_not_found", message: `'${service_name}' לא ברשימת השירותים` },
      { status: 404 },
    );
  }

  const target: ProductKpiTarget = {
    value,
    kind,
    set_at: new Date().toISOString(),
    source,
  };
  const updated: Product[] = products.map((p, i) =>
    i === idx ? { ...p, kpi_target: target } : p,
  );

  const payload: BusinessKnowledgeUpsert = {
    business_id: business.id,
    vertical: current.vertical,
    website_url: current.website_url,
    service_regions: current.service_regions,
    geo_targeting: current.geo_targeting,
    customer_age_min: current.customer_age_min,
    customer_age_max: current.customer_age_max,
    products: updated,
    delivery_time_days: current.delivery_time_days,
    strong_seasons: current.strong_seasons,
    weak_seasons: current.weak_seasons,
    questionnaire_answers: current.questionnaire_answers,
    brand_voice: current.brand_voice,
    competitors: current.competitors,
  };
  await db.upsertBusinessKnowledge(payload);

  return NextResponse.json({ ok: true, service_name, kpi_target: target });
}
