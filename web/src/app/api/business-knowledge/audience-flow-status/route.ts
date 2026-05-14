import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/business-knowledge/audience-flow-status?service_name=<name>
 *
 * Block 13 follow-up (2026-05-13) — UX truthiness for ServiceAudienceButton.
 * Returns running state + recent heartbeat timestamps for Flow E, plus the
 * count of pending audience proposals tagged to this service.
 *
 * Used by:
 *   1. ServiceAudienceButton polls every ~2s while in "running" state.
 *   2. POST propose-audiences calls the underlying adapter to 409 a duplicate
 *      spawn.
 */
const querySchema = z.object({
  service_name: z.string().min(1).max(200).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const business = await getActiveBusiness();
  if (!business) {
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    service_name: url.searchParams.get("service_name") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: parsed.error.message },
      { status: 400 },
    );
  }
  const serviceName = parsed.data.service_name ?? null;

  const db = getDataClient();
  const status = await db.getAudienceFlowStatus(business.id, serviceName);

  return NextResponse.json({
    ok: true,
    business_id: business.id,
    service_name: serviceName,
    ...status,
  });
}
