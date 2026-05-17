import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getAuth } from "@/lib/auth";
import { getActiveBusiness } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/audiences/sync — fire-and-wait trigger for sync_audiences.py.
 *
 * Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
 * §4.2 Step 9). Runs the Python tool inside the `campaigner` container against
 * the active business and returns the summary JSON it prints. We wait for
 * completion here (typical sync < 5s for an SMB account); the daily cron
 * handles the unattended case.
 */
export async function POST(_req: NextRequest) {
  // Auth is the admin gate. We previously also blocked on
  // NODE_ENV=production, but the local dev container runs `pnpm build &&
  // pnpm start` for performance, which sets NODE_ENV=production and hid
  // the button in dev. Real cloud production doesn't mount the docker
  // socket the spawn below relies on, so the call fails naturally there
  // rather than firing silently. Same shape as /api/runners/trigger.
  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getActiveBusiness();
  if (!business)
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });

  const cmd = `docker exec campaigner python -m campaigner.tools.sync_audiences --business-id ${business.id}`;
  console.log(`[audiences/sync] cmd=${cmd}`);

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
    console.error(`[audiences/sync] exit=${exitCode} stderr=${stderrBuf}`);
    return NextResponse.json(
      {
        error: "sync_failed",
        exit_code: exitCode,
        stderr: stderrBuf.slice(-1000),
      },
      { status: 500 },
    );
  }

  // sync_audiences emits a single JSON line on stdout; strip the
  // "Meta Ads API inicializada" banner the legacy adapter prints to stdout.
  const jsonLine = stdoutBuf
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"));

  if (!jsonLine) {
    return NextResponse.json(
      { error: "sync_returned_no_json", stdout: stdoutBuf.slice(-1000) },
      { status: 500 },
    );
  }

  try {
    const summary = JSON.parse(jsonLine);
    return NextResponse.json({ ok: true, summary }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      {
        error: "sync_returned_invalid_json",
        stdout: stdoutBuf.slice(-1000),
        parse_error: String(e),
      },
      { status: 500 },
    );
  }
}
