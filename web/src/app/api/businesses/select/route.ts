import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  ACTIVE_BUSINESS_COOKIE,
  ACTIVE_BUSINESS_COOKIE_OPTIONS,
} from "@/lib/active-business";
import { isMetaAppConfigured, loadMetaAppConfig } from "@/lib/meta-app-config";

/**
 * POST /api/businesses/select
 *
 * Form-encoded body:
 *   - business_id: uuid of the business to switch to
 *   - next?: optional path to redirect to after switching (default '/')
 *
 * Sets the `campaigner_business_id` cookie. Every page that calls
 * `getActiveBusiness()` then resolves to the new business automatically.
 *
 * Validates that the business exists + is active to prevent stale-cookie
 * states; returns 404 if not. We deliberately don't validate that the session
 * user "owns" the business since current MVP has one operator (Aiweon admin)
 * managing every client.
 */
const bodySchema = z.object({
  business_id: z.string().uuid(),
  next: z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const parsed = bodySchema.safeParse({
    business_id: form.get("business_id"),
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const db = getDataClient();
  const target = await db.getBusinessById(parsed.data.business_id);
  if (!target || !target.active) {
    return NextResponse.json({ error: "business_not_found" }, { status: 404 });
  }

  // Constrain `next` to same-origin paths only (no open redirect).
  const safeNext =
    parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/";

  // Inside Docker, req.url.origin is the container-internal :3000 — using it
  // sends the browser to a port that isn't published on the host (the user
  // accesses :3100). Prefer META_PUBLIC_ORIGIN when configured.
  let origin: string;
  if (isMetaAppConfigured()) {
    origin = loadMetaAppConfig().publicOrigin;
  } else {
    origin = new URL(req.url).origin;
  }
  const res = NextResponse.redirect(`${origin}${safeNext}`, 303);
  res.cookies.set(
    ACTIVE_BUSINESS_COOKIE,
    target.id,
    ACTIVE_BUSINESS_COOKIE_OPTIONS,
  );
  return res;
}
