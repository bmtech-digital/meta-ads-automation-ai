import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GradeSchema = z.object({
  lead_id: z.string().uuid(),
  business_id: z.string().uuid(),
  grade: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  note: z.string().nullable().optional(),
  converted: z.boolean().nullable().optional(),
  converted_value_ils: z.number().nullable().optional(),
});

/**
 * POST /api/leads/grade — record an operator quality grade on a lead.
 *
 * Phase 2 (mastery plan §5). The grade feeds into the
 * `winner_requires_quality_grade` guardrail (§40) and the quality-adjusted
 * CPL math the agent uses in Gate 2.
 */
export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = GradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const db = getDataClient();
    const result = await db.gradeLead({
      ...parsed.data,
      graded_by: session.email ?? null,
    });
    return NextResponse.json({ ok: true, grade_id: result.grade_id });
  } catch (e) {
    console.error(`[leads/grade] failed`, e);
    return NextResponse.json(
      { error: "grade_failed", message: String(e).slice(0, 300) },
      { status: 500 },
    );
  }
}
