import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FLOWS = new Set([
  "daily_observe_propose",
  "execute_approvals",
  "weekly_creative_firehose",
  "weekly_competitive_research",
  // Mastery v2 additions (2026-05-17)
  "onboarding_chain", // Phase A — runs the post-OAuth chain
  "weekly_digest", // Phase E — Sunday Hebrew digest
]);

export async function POST(req: NextRequest) {
  // Auth is the admin gate — anyone signed in (i.e. through the login form)
  // can trigger a run from the dashboard. We previously also blocked on
  // NODE_ENV=production, but the local dev container runs `pnpm build &&
  // pnpm start` for performance, which set NODE_ENV=production and hid the
  // buttons in dev. The actual execution still requires the docker-cli +
  // /var/run/docker.sock mount (see docker-compose.yml web service) — in
  // real cloud production neither is present, so the spawn would fail
  // naturally rather than silently fire.
  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const flow = typeof body?.flow === "string" ? body.flow : "";
  if (!ALLOWED_FLOWS.has(flow)) {
    return NextResponse.json({ error: "invalid_flow" }, { status: 400 });
  }

  // BUSINESS_ID resolution: onboarding_chain + weekly_digest are per-business
  // runners (heartbeat keyed on business_id); the legacy flows also support
  // it but currently fall back to the env-default. Always pass it through.
  let businessId =
    typeof body?.business_id === "string" ? body.business_id : "";
  if (!businessId) {
    try {
      const biz = await getDataClient().getFirstBusiness();
      if (biz) businessId = biz.id;
    } catch (e) {
      console.warn(
        `[runners/trigger] could not resolve default business: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }

  // For onboarding_chain we additionally flip status not_started → brief_pending
  // if it's still null + record onboarding_started_at on the first trigger.
  // This way the chain advances cleanly when invoked right after OAuth.
  if (flow === "onboarding_chain" && businessId) {
    try {
      await getDataClient().beginOnboardingIfNeeded(businessId);
    } catch (e) {
      console.warn(
        `[runners/trigger] beginOnboardingIfNeeded failed for ${businessId}: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }

  // exec into the already-running `campaigner` container (see docker-compose.yml).
  // Requires docker CLI + socket mount in the web container — dev-only.
  const envPrefix = businessId ? `BUSINESS_ID=${businessId} ` : "";
  const cmd = `docker exec -e BUSINESS_ID=${businessId || "''"} campaigner bash runners/${flow}.sh`;
  console.log(`[runners/trigger] cmd=${envPrefix}${cmd}`);

  const child = spawn(cmd, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (b) =>
    process.stdout.write(`[runner:${flow}] ${b}`),
  );
  child.stderr?.on("data", (b) =>
    process.stderr.write(`[runner:${flow}] ${b}`),
  );

  const earlyFailure = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 1200);
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
    console.error(`[runners/trigger] ${earlyFailure}`);
    return NextResponse.json({ error: earlyFailure }, { status: 500 });
  }

  child.unref();
  return NextResponse.json({ ok: true, flow }, { status: 202 });
}
