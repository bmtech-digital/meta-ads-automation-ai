import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig } from "@/lib/meta-app-config";
import { MetaGraphError, parseSignedRequest } from "@/lib/meta-graph";

/**
 * POST /api/meta/data-deletion
 *
 * Webhook Meta calls when a user requests their data be deleted (GDPR-like).
 * Body is `application/x-www-form-urlencoded` with `signed_request`.
 *
 * Per Meta spec (https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/),
 * we must return JSON: `{ url, confirmation_code }`.
 *   - `url`: a page the user can visit to see deletion status.
 *   - `confirmation_code`: opaque string, also shown on the status page.
 *
 * Implementation today (MVP):
 *   1. Validate signed_request.
 *   2. Mark every connection for this Meta user as `revoked` (same as
 *      deauthorize) — first step of deletion.
 *   3. Compute a stable confirmation_code from a hash of the user_id +
 *      a random salt (so duplicate requests get the same code in the same
 *      session). Logged for operator follow-up.
 *   4. Return the JSON Meta expects.
 *
 * Full data wipe (purging meta_api_calls audit, scrubbing creative_gallery
 * references) is a manual operator job for now — there's no automatic
 * "delete everything" because we may have legal hold reasons to retain
 * audit logs. The status URL surfaces what's still in flight.
 *
 * Required for Meta App Review.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let config;
  try {
    config = loadMetaAppConfig();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "config" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const signedRequest = String(form.get("signed_request") ?? "");
  if (!signedRequest) {
    return NextResponse.json(
      { error: "missing signed_request" },
      { status: 400 },
    );
  }

  let payload: { user_id: string };
  try {
    payload = parseSignedRequest(signedRequest, config.appSecret);
  } catch (e) {
    const msg =
      e instanceof MetaGraphError ? e.message : "signed_request invalid";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const db = getDataClient();
  const connections = await db.findConnectionsByMetaUserId(payload.user_id);
  await Promise.all(
    connections.map((c) => db.markConnectionRevoked(c.id)),
  );

  // Confirmation code: hash of user_id + per-request random salt. Logged
  // server-side so an operator can correlate a status-page visit to a
  // request. Visible to the user.
  const salt = randomBytes(8).toString("hex");
  const confirmation = createHash("sha256")
    .update(`${payload.user_id}:${salt}`)
    .digest("hex")
    .slice(0, 16);

  console.log(
    `[data-deletion] meta_user_id=${payload.user_id} ` +
      `confirmation=${confirmation} revoked=${connections.length}`,
  );

  return NextResponse.json({
    url: `${config.publicOrigin}/data-deletion-status?code=${confirmation}`,
    confirmation_code: confirmation,
  });
}
