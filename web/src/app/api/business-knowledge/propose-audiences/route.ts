import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { getActiveBusiness } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  service_name: z.string().min(1).max(200),
});

/**
 * POST /api/business-knowledge/propose-audiences
 *   body: { service_name: string }
 *
 * Operator-initiated trigger for Flow E (CAMPAIGNER.md) — fires the agent
 * with `propose audiences for service` + `SERVICE_NAME=<name>`. The agent
 * follows §T_AUD in decision-tree.md and writes 1-3 audience proposals
 * (Custom / Saved / Lookalike) into `approvals` via `propose_audience.py`.
 *
 * Validates that the service exists in `business_knowledge.products` BEFORE
 * spawning the runner — saves a wasted Claude invocation when the operator
 * typed a service that isn't in their profile.
 *
 * Returns 202 once the runner has spawned without an immediate crash. The
 * UI shows "running" and the operator polls /approvals or the agent's
 * decision trail for results — proposals land 30-90s later.
 */
export async function POST(req: NextRequest) {
  // The dev path uses `docker exec` to invoke the campaigner container's
  // runner script. That's only meaningful when web + campaigner run in the
  // same docker-compose stack (i.e. local development). In production the
  // agent runs as a Cloud Run Job and needs the GCP Jobs API — wiring that
  // path is a separate follow-up (see TODO below). For now, fail loudly
  // with a clearer message than a generic 403 so operators understand.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "not_wired_in_production",
        message:
          "operator-initiated Flow E requires the Cloud Run Job invocation path, which is not yet wired (P2 follow-up). On dev / local docker, the docker-exec path works.",
      },
      { status: 501 },
    );
  }

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
      {
        error: "no_business_knowledge",
        message: "מלא קודם את /business-knowledge",
      },
      { status: 400 },
    );
  }
  const products = current.products ?? [];
  const product = products.find(
    (p) => p.name.trim().toLowerCase() === service_name.trim().toLowerCase(),
  );
  if (!product) {
    return NextResponse.json(
      {
        error: "service_not_found",
        message: `'${service_name}' לא ברשימת השירותים — הוסף אותו תחת 'השירותים שלי' קודם.`,
      },
      { status: 404 },
    );
  }

  // Dedupe: if Flow E is already running for this (business, service), don't
  // spawn a second runner. Block 13 follow-up — fast double-clicks used to
  // produce 2-6 duplicate audience proposals.
  const status = await db.getAudienceFlowStatus(business.id, product.name);
  if (status.running) {
    return NextResponse.json(
      {
        error: "already_running",
        message:
          "כבר רץ עכשיו מחקר קהלים לשירות הזה. חכה כדקה — ההצעות יגיעו ל-/approvals.",
        last_start_at: status.last_start_at,
      },
      { status: 409 },
    );
  }

  // Pass BUSINESS_ID + SERVICE_NAME via `docker exec -e` to the already-running
  // campaigner container. Matches /api/runners/trigger's pattern (dev-only —
  // production uses Cloud Run Jobs and a different invocation path).
  //
  // Shell-quoting note: SERVICE_NAME goes through shell:true, so the value
  // is single-quoted and any embedded ' is escaped via Bash's '\'' trick.
  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const cmd = [
    "docker exec",
    `-e BUSINESS_ID=${sq(business.id)}`,
    `-e SERVICE_NAME=${sq(product.name)}`,
    "campaigner",
    "bash runners/propose_audiences_for_service.sh",
  ].join(" ");
  console.log(`[propose-audiences] cmd=${cmd}`);

  const child = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });

  child.stdout?.on("data", (b) =>
    process.stdout.write(`[propose-audiences:${product.name}] ${b}`),
  );
  child.stderr?.on("data", (b) =>
    process.stderr.write(`[propose-audiences:${product.name}] ${b}`),
  );

  const earlyFailure = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    child.once("error", (e) => {
      clearTimeout(timer);
      resolve(`spawn_failed: ${e.message}`);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) resolve(`exited_early: code=${code}`);
      else if (signal) resolve(`exited_early: signal=${signal}`);
      else resolve(null);
    });
  });

  if (earlyFailure) {
    console.error(`[propose-audiences] ${earlyFailure}`);
    return NextResponse.json({ error: earlyFailure }, { status: 500 });
  }

  child.unref();
  return NextResponse.json(
    {
      ok: true,
      service_name: product.name,
      flow: "propose_audiences_for_service",
      message:
        "הסוכן יחקור קהלים לשירות הזה ויוסיף 1-3 הצעות לאישור (תוך כדקה).",
    },
    { status: 202 },
  );
}
