import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { z } from "zod";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/new — operator-spec'd new_campaign proposal builder.
 *
 * Phase 3 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
 * §6). Takes the wizard form output, assembles the full propose_task
 * new_campaign payload, and inserts an approval row via the Python
 * `propose_task` CLI. Operator approves at /approvals/<id> and Flow B
 * dispatches the chain.
 */

const PayloadSchema = z.object({
  business_id: z.string().uuid(),
  campaign_name: z.string().min(3).max(120),
  objective: z.enum([
    "OUTCOME_LEADS",
    "OUTCOME_SALES",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_TRAFFIC",
    "OUTCOME_AWARENESS",
    "OUTCOME_APP_PROMOTION",
  ]),
  daily_budget_ils: z.number().positive(),
  custom_audience_ids: z.array(z.string()).default([]),
  excluded_audience_ids: z.array(z.string()).default([]),
  age_min: z.number().int().min(18).max(65),
  age_max: z.number().int().min(18).max(65),
  advantage_audience: z.boolean(),
  optimization_goal: z.string(),
  headline: z.string().min(1).max(80),
  primary_text: z.string().min(1).max(500),
  cta: z.string(),
  link_url: z.string().url(),
  image_path: z.string().nullable().optional(),
  page_id: z.string().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const f = parsed.data;
  const adsetName = `${f.campaign_name} - Ad Set`;
  const adName = `${f.campaign_name} - Ad`;

  // Build the targeting spec.
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: ["IL"] },
    age_min: f.age_min,
    age_max: f.age_max,
    targeting_automation: { advantage_audience: f.advantage_audience ? 1 : 0 },
    publisher_platforms: ["facebook", "instagram"],
  };
  if (f.custom_audience_ids.length > 0) {
    targeting.custom_audiences = f.custom_audience_ids.map((id) => ({ id }));
  }
  if (f.excluded_audience_ids.length > 0) {
    targeting.excluded_custom_audiences = f.excluded_audience_ids.map((id) => ({
      id,
    }));
  }

  // Promoted_object — required for lead-gen and messaging objectives.
  const promoted_object: Record<string, unknown> = {};
  if (f.objective === "OUTCOME_LEADS") {
    if (f.page_id) promoted_object.page_id = f.page_id;
  } else if (f.objective === "OUTCOME_ENGAGEMENT") {
    if (f.page_id) promoted_object.page_id = f.page_id;
  }

  const payload: Record<string, unknown> = {
    campaign_name: f.campaign_name,
    objective: f.objective,
    special_ad_categories: [],
    daily_budget_ils: f.daily_budget_ils,
    adset_name: adsetName,
    optimization_goal: f.optimization_goal,
    billing_event: "IMPRESSIONS",
    targeting,
    ad_name: adName,
    creative_kind: "image",
    creative_source: f.image_path ? { image_path: f.image_path } : {},
    copy: {
      headline: f.headline,
      primary_text: f.primary_text,
      cta: f.cta,
      link_url: f.link_url,
    },
    identity: f.page_id ? { page_id: f.page_id } : {},
    tracking: {
      url_tags: `utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(
        f.campaign_name,
      )}`,
    },
  };
  if (Object.keys(promoted_object).length > 0) {
    (payload as Record<string, unknown>).promoted_object = promoted_object;
  }

  const rationale = [
    `הסוכן (דרך אשף /campaigns/new) מציע קמפיין חדש: "${f.campaign_name}".`,
    `מטרה: ${f.objective}. תקציב יומי: ₪${f.daily_budget_ils}.`,
    `קהלים מותאמים: ${f.custom_audience_ids.length || "ללא"}; הוצאות: ${f.excluded_audience_ids.length || "ללא"}.`,
    `גילאים: ${f.age_min}-${f.age_max}. Advantage+ Audience: ${f.advantage_audience ? "פעיל" : "כבוי"}.`,
    "",
    "אישור = יצירת קמפיין + ad set + מודעה ב-Meta במצב PAUSED. בזק קיצוני שכלום לא יעלה לאוויר עד שתפעיל ידנית.",
    "דחייה = ההצעה נסגרת ללא פעולה.",
  ].join("\n");

  // Generate a run_id for traceability of this manual-operator action.
  const runId = crypto.randomUUID();

  const cmd =
    `docker exec campaigner python -m campaigner.tools.propose_task ` +
    `--business-id ${f.business_id} ` +
    `--run-id ${runId} ` +
    `--task-type new_campaign ` +
    `--target-kind account ` +
    `--target-id ${process.env.META_AD_ACCOUNT_ID ?? ""} ` +
    `--payload ${JSON.stringify(JSON.stringify(payload))} ` +
    `--rationale ${JSON.stringify(rationale)} ` +
    `--urgency medium`;

  const child = spawn(cmd, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout?.on("data", (b: Buffer) => {
    stdoutBuf += b.toString();
  });
  child.stderr?.on("data", (b: Buffer) => {
    stderrBuf += b.toString();
  });

  const exitCode: number = await new Promise((resolve) => {
    child.once("error", () => resolve(255));
    child.once("exit", (code) => resolve(code ?? 255));
  });

  if (exitCode !== 0) {
    return NextResponse.json(
      {
        error: "propose_failed",
        exit_code: exitCode,
        stderr: stderrBuf.slice(-1500),
      },
      { status: 500 },
    );
  }

  const jsonLine = stdoutBuf
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    return NextResponse.json(
      { error: "propose_returned_no_json", stdout: stdoutBuf.slice(-1500) },
      { status: 500 },
    );
  }

  try {
    const result = JSON.parse(jsonLine);
    return NextResponse.json({
      ok: true,
      approval_id: result.approval_id,
      run_id: runId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "propose_returned_invalid_json", parse_error: String(e) },
      { status: 500 },
    );
  }
}
