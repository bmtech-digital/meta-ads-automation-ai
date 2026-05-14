import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";
import { importAiweonServices } from "@/lib/aiweon-services-importer";
import type { BusinessKnowledgeUpsert } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/business-knowledge/import-aiweon
 *
 *   body: { preview?: boolean }
 *
 * Reads d:\aiweon-ser\aiweon-ser\messages\he.json, extracts the 4 AIWEON
 * services, and either previews (preview=true) or upserts them into the
 * active business's `business_knowledge.products` column.
 *
 * Preview-then-commit lets the operator see the resulting product list
 * before it overwrites whatever they have today — the importer always
 * REPLACES products[], never merges, to avoid stale entries lingering.
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

  const body = (await req.json().catch(() => ({}))) as { preview?: boolean };
  const isPreview = body.preview === true;

  let result;
  try {
    result = await importAiweonServices();
  } catch (e) {
    return NextResponse.json(
      {
        error: "import_failed",
        message: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 },
    );
  }

  if (isPreview) {
    return NextResponse.json(
      {
        ok: true,
        preview: true,
        products: result.products,
        source_path: result.source_path,
        summary: result.summary,
      },
      { status: 200 },
    );
  }

  // Commit: REPLACE products[]. Keep everything else on the row untouched.
  const db = getDataClient();
  const current = await db.getBusinessKnowledge(business.id);
  // Build a minimal upsert payload — only the products field changes, but
  // upsertBusinessKnowledge expects the full shape. Pass current values so
  // nothing else gets nulled out.
  const payload: BusinessKnowledgeUpsert = {
    business_id: business.id,
    vertical: current?.vertical ?? "b2b_saas",
    website_url: current?.website_url ?? null,
    service_regions: current?.service_regions ?? null,
    geo_targeting: current?.geo_targeting ?? null,
    customer_age_min: current?.customer_age_min ?? null,
    customer_age_max: current?.customer_age_max ?? null,
    products: result.products,
    delivery_time_days: current?.delivery_time_days ?? null,
    strong_seasons: current?.strong_seasons ?? null,
    weak_seasons: current?.weak_seasons ?? null,
    questionnaire_answers: current?.questionnaire_answers ?? null,
    brand_voice: current?.brand_voice ?? null,
    competitors: current?.competitors ?? null,
  };
  await db.upsertBusinessKnowledge(payload);

  return NextResponse.json(
    {
      ok: true,
      preview: false,
      products_count: result.products.length,
      source_path: result.source_path,
      summary: result.summary,
    },
    { status: 200 },
  );
}
