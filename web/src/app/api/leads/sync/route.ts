import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getAuth } from "@/lib/auth";
import { getActiveBusiness } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/sync — fire-and-wait trigger for sync_leads.py.
 *
 * Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
 * §5 Step 7). Pulls Meta Lead Form submissions into the local `leads` table
 * and returns the summary JSON. Daily cron also runs this — this endpoint is
 * for on-demand operator triggers from /leads.
 */
export async function POST(_req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "disabled_in_production_use_cron" },
      { status: 403 },
    );
  }

  const session = await getAuth().getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getActiveBusiness();
  if (!business)
    return NextResponse.json({ error: "no_active_business" }, { status: 400 });

  const cmd = `docker exec campaigner python -m campaigner.tools.sync_leads --business-id ${business.id} --since-days 60`;
  console.log(`[leads/sync] cmd=${cmd}`);

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
    console.error(`[leads/sync] exit=${exitCode} stderr=${stderrBuf}`);
    return NextResponse.json(
      {
        error: "sync_failed",
        exit_code: exitCode,
        stderr: stderrBuf.slice(-1000),
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
