import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PromoteSchema = z.object({
  asset_id: z.string().uuid(),
  score: z.number().int(),
  reasons: z.array(z.string()).max(10),
});

function buildRationale(score: number, reasons: string[]): string {
  // Plain Hebrew per CAMPAIGNER personality guideline — no English acronyms
  // in paragraph 1.
  const head = `המשתמש קידם את הנכס מהגלריה לקמפיין הבא. הציון הוא ${score}.`;
  if (reasons.length === 0) return head;
  const list = reasons
    .slice(0, 5)
    .map((r) => `· ${r}`)
    .join("\n");
  return `${head}\n\nסיבות:\n${list}`;
}

export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PromoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDataClient();
  const business = await getActiveBusiness();
  if (!business) {
    return NextResponse.json({ error: "business_not_found" }, { status: 404 });
  }

  const asset = await db.getGalleryAssetById(parsed.data.asset_id);
  if (!asset || asset.business_id !== business.id) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (asset.meta_creative_id) {
    return NextResponse.json(
      { error: "already_in_meta", meta_creative_id: asset.meta_creative_id },
      { status: 409 },
    );
  }

  const rationale = buildRationale(parsed.data.score, parsed.data.reasons);

  try {
    const row = await db.createPromotionApproval({
      business_id: business.id,
      asset_id: parsed.data.asset_id,
      score: parsed.data.score,
      reasons: parsed.data.reasons,
      rationale,
      // One UUID per click — each promotion is its own "run" of human action.
      created_by_run_id: randomUUID(),
    });
    return NextResponse.json({ approval: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create_failed";
    return NextResponse.json({ error: "create_failed", detail: msg }, { status: 500 });
  }
}
