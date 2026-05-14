import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";
import {
  estimateCPL,
  matchSubVertical,
  monthOf,
  pickGeoTier,
  SUBVERTICALS,
} from "@/lib/cpl-infrastructure";
import type {
  BusinessKnowledgeUpsert,
  Product,
  ProductResearch,
  Vertical,
} from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  service_name: z.string().min(1).max(200),
});

/**
 * POST /api/business-knowledge/research-service
 *
 *   body: { service_name: string }
 *
 * Runs the static `estimateCPL` with the service_name as `campaign_name`
 * (×3 weight) so the match is per-service, not business-aggregate. Writes
 * the resulting research block to that product's `research` field on
 * `business_knowledge.products`. Persists, so future scans + the dashboard
 * tile can read this per-service benchmark.
 *
 * When `match.confidence_of_match === "fallback"` (no terms matched), the
 * route returns a clear error rather than silently writing a low-quality
 * estimate. The operator should refine the service name/description.
 */
export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const business = await getActiveBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: parsed.error.message },
      { status: 400 },
    );
  }
  const { service_name } = parsed.data;

  const db = getDataClient();
  const current = await db.getBusinessKnowledge(business.id);
  if (!current) {
    return NextResponse.json(
      { error: "no_business_knowledge", message: "fill /business-knowledge first" },
      { status: 400 },
    );
  }

  // Find the product to research. Match by exact name (case-insensitive,
  // trimmed) — first hit wins. If not found, return 404 with a hint that
  // the operator should add the service to products first.
  const products = current.products ?? [];
  const targetIdx = products.findIndex(
    (p) => p.name.trim().toLowerCase() === service_name.trim().toLowerCase(),
  );
  if (targetIdx === -1) {
    return NextResponse.json(
      {
        error: "service_not_found",
        message: `'${service_name}' לא נמצא ברשימת השירותים — הוסף אותו תחת 'השירותים שלי' קודם.`,
      },
      { status: 404 },
    );
  }
  const product = products[targetIdx];

  // Build the same context the agent uses: full product line as the haystack
  // PLUS the service name as the campaign_name override (×3 weight).
  const productsBlob = products
    .map((p) => (p.description ? `${p.name} — ${p.description}` : p.name))
    .join("  ");
  const qa = (current.questionnaire_answers ?? {}) as Record<
    string,
    string | undefined
  >;
  const match = matchSubVertical({
    vertical: current.vertical as Vertical | null,
    products_raw: productsBlob || null,
    ideal_customer: qa.ideal_customer ?? null,
    usp: qa.usp ?? null,
    main_pain: qa.main_pain ?? null,
    campaign_name: service_name,
  });

  if (match.confidence_of_match === "fallback") {
    return NextResponse.json(
      {
        error: "no_subvertical_match",
        message: `'${service_name}' לא מצליח להתחבר לאף תת-ורטיקל. שכלל את התיאור של השירות תחת 'השירותים שלי' עם מילים יותר ספציפיות.`,
      },
      { status: 422 },
    );
  }

  const cell = SUBVERTICALS[match.sub];
  // Use leads/B2C default (CTWA) for leads-parent verticals, else lead_form.
  const channel: "click_to_whatsapp" | "lead_form" =
    cell.parent === "leads" ? "click_to_whatsapp" : "lead_form";
  const estimate = estimateCPL({
    sub: match.sub,
    geo: pickGeoTier(current.service_regions ?? null),
    stage: "cold",
    offer: "consultation_free",
    channel,
    month: monthOf(new Date()),
    security_event: false,
  });

  const context_used: string[] = ["service_name"];
  if (current.vertical) context_used.push("vertical");
  if (productsBlob) context_used.push("products");
  if (current.service_regions?.length) context_used.push("service_regions");
  if (qa.ideal_customer) context_used.push("ideal_customer");
  if (qa.usp) context_used.push("usp");

  const research: ProductResearch = {
    market_average_ils: estimate.value_ils,
    band_low_ils: estimate.band_ils[0],
    band_high_ils: estimate.band_ils[1],
    sub_vertical: match.sub,
    matched_terms: match.matched_terms,
    confidence: estimate.confidence,
    sources: estimate.citations.map((c) => ({
      title: c.title,
      url: c.url,
      extracted: c.extracted,
    })),
    context_used,
    source_of_estimate: "static_cpl_infrastructure",
    researched_at: new Date().toISOString(),
  };

  // Replace the product in-place with the research field set.
  const updatedProducts: Product[] = products.map((p, idx) =>
    idx === targetIdx ? { ...p, research } : p,
  );

  const payload: BusinessKnowledgeUpsert = {
    business_id: business.id,
    vertical: current.vertical,
    website_url: current.website_url,
    service_regions: current.service_regions,
    geo_targeting: current.geo_targeting,
    customer_age_min: current.customer_age_min,
    customer_age_max: current.customer_age_max,
    products: updatedProducts,
    delivery_time_days: current.delivery_time_days,
    strong_seasons: current.strong_seasons,
    weak_seasons: current.weak_seasons,
    questionnaire_answers: current.questionnaire_answers,
    brand_voice: current.brand_voice,
    competitors: current.competitors,
  };
  await db.upsertBusinessKnowledge(payload);

  return NextResponse.json(
    {
      ok: true,
      service_name,
      research,
      summary: `${service_name}: ${match.sub} → ₪${estimate.value_ils} (₪${estimate.band_ils[0]}–₪${estimate.band_ils[1]}, ${estimate.confidence})`,
    },
    { status: 200 },
  );
}
