import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { isMetaAppConfigured, loadMetaAppConfig } from "@/lib/meta-app-config";

/**
 * POST /api/meta/oauth/disconnect
 *
 * Operator-initiated disconnect. Marks the connection `revoked`. Keeps the
 * encrypted token + asset rows in place (for audit) — they're filtered out by
 * the active-connection query.
 */
const bodySchema = z.object({
  connection_id: z.string().uuid(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData();
  const parsed = bodySchema.safeParse({
    connection_id: form.get("connection_id"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  await getDataClient().markConnectionRevoked(parsed.data.connection_id);

  // Inside Docker, req.url.origin is :3000 (container-internal); the user
  // accesses the host-mapped :3100. Prefer META_PUBLIC_ORIGIN when set.
  let origin: string;
  if (isMetaAppConfigured()) {
    origin = loadMetaAppConfig().publicOrigin;
  } else {
    origin = new URL(req.url).origin;
  }
  return NextResponse.redirect(`${origin}/integrations?disconnected=1`, 303);
}
