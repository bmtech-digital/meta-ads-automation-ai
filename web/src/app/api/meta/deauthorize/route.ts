import { NextResponse } from "next/server";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig } from "@/lib/meta-app-config";
import { MetaGraphError, parseSignedRequest } from "@/lib/meta-graph";

/**
 * POST /api/meta/deauthorize
 *
 * Webhook Meta calls when a user removes our app from their account. Body is
 * `application/x-www-form-urlencoded` with one field: `signed_request`.
 *
 * Per Meta docs, the response is informational only — Meta doesn't enforce a
 * specific shape. We:
 *   1. Validate the signed_request HMAC.
 *   2. Find every connection owned by that `user_id` (could span businesses).
 *   3. Mark each connection `status='revoked'` so the UI prompts reconnect.
 *
 * No 401 path — if the signature fails, return 400 so Meta retries with a
 * fresh request instead of treating the endpoint as broken.
 *
 * Required for Meta App Review (decisions-log §1.12 + meta-app-review-submission.md).
 */
export async function POST(req: Request): Promise<NextResponse> {
  let config;
  try {
    config = loadMetaAppConfig();
  } catch (e) {
    // Misconfigured server — return 500 so Meta retries.
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

  return NextResponse.json({
    ok: true,
    revoked_count: connections.length,
  });
}
