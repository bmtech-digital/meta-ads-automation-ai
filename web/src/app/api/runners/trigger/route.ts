import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FLOWS = new Set([
  "daily_observe_propose",
  "execute_approvals",
  "weekly_creative_firehose",
]);

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled_in_production" }, { status: 403 });
  }

  const session = await getAuth().getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const flow = typeof body?.flow === "string" ? body.flow : "";
  if (!ALLOWED_FLOWS.has(flow)) {
    return NextResponse.json({ error: "invalid_flow" }, { status: 400 });
  }

  // exec into the already-running `campaigner` container (see docker-compose.yml).
  // Requires docker CLI + socket mount in the web container — dev-only.
  const cmd = `docker exec campaigner bash runners/${flow}.sh`;
  console.log(`[runners/trigger] cmd=${cmd}`);

  const child = spawn(cmd, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (b) => process.stdout.write(`[runner:${flow}] ${b}`));
  child.stderr?.on("data", (b) => process.stderr.write(`[runner:${flow}] ${b}`));

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
