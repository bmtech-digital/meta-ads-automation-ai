import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/audiences/[id]/service-tag
 *   body: { service_tag: string | null }
 *
 * Block 13 follow-up (2026-05-13) — manual service_tag assignment from
 * /audiences. Used for audiences that were synced from Meta (created
 * manually in Ads Manager) and therefore have no service_tag yet, OR to
 * re-assign an audience to a different service.
 *
 * Validation:
 *   - The audience must exist for this business.
 *   - When service_tag is non-null, it must match a product.name in
 *     business_knowledge.products (same rule as propose_audience.py).
 *   - Passing null clears the assignment.
 */
const bodySchema = z.object({
  service_tag: z.string().min(1).max(200).nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const business = await getActiveBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });
  }

  const { id: audienceId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: parsed.error.message },
      { status: 400 },
    );
  }
  const { service_tag } = parsed.data;

  // Validate service_tag matches a real product (when not clearing). Mirrors
  // propose_audience.py:_validate_service_tag so the agent path and the
  // operator path enforce the same invariant.
  const db = getDataClient();
  if (service_tag !== null) {
    const k = await db.getBusinessKnowledge(business.id);
    const products = k?.products ?? [];
    const norm = service_tag.trim().toLowerCase();
    const exists = products.some(
      (p) => typeof p.name === "string" && p.name.trim().toLowerCase() === norm,
    );
    if (!exists) {
      return NextResponse.json(
        {
          error: "service_not_found",
          message: `'${service_tag}' לא ברשימת השירותים — הוסף אותו תחת 'השירותים שלי' קודם.`,
        },
        { status: 404 },
      );
    }
  }

  const updated = await db.setAudienceServiceTag(
    business.id,
    audienceId,
    service_tag,
  );
  if (!updated) {
    return NextResponse.json(
      {
        error: "audience_not_found",
        message:
          "הקהל לא נמצא לעסק הנוכחי (יכול להיות שהוא ארכובי או שייך לעסק אחר).",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    audience: updated,
  });
}
