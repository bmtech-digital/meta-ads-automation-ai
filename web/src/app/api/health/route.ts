import { NextResponse } from "next/server";
import { getDataClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDataClient();
    await db.ping();
    return NextResponse.json({ ok: true, db: db.mode });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
