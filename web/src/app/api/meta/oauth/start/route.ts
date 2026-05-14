import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { signOAuthState } from "@/lib/crypto";
import { getDataClient } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import {
  loadMetaAppConfig,
  oauthRedirectUri,
  scopeStringForTier,
  META_OAUTH_DIALOG,
} from "@/lib/meta-app-config";

/**
 * POST /api/meta/oauth/start
 *
 * Form-encoded body: `business_id=<uuid>` (the business this connection
 * attaches to). The session user must be signed in — we record them as
 * `connected_by_user_id` for audit.
 *
 * Flow:
 *   1. Sign in check.
 *   2. Generate fresh nonce + sign HMAC state with payload
 *      { app_user_id, business_id, nonce, ts }.
 *   3. Persist state row in `meta_oauth_state` (10-min TTL, single-use).
 *   4. Redirect to Meta's OAuth dialog.
 *
 * Returns: 303 redirect to facebook.com. The browser bounces back to
 * /api/meta/oauth/callback after the user authorizes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const businessId = String(form.get("business_id") ?? "");
  if (!businessId) {
    return NextResponse.json({ error: "missing business_id" }, { status: 400 });
  }

  let config;
  try {
    config = loadMetaAppConfig();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "meta config error" },
      { status: 500 },
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const ts = Date.now();
  const state = signOAuthState({
    app_user_id: session.email,
    business_id: businessId,
    nonce,
    ts,
  });

  const db = getDataClient();
  const ok = await db.insertOAuthState({
    state,
    app_user_id: session.email,
    business_id: businessId,
    expires_at: new Date(ts + 10 * 60 * 1000).toISOString(),
  });
  if (!ok) {
    return NextResponse.json(
      { error: "state collision; retry" },
      { status: 500 },
    );
  }

  const dialogParams = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: oauthRedirectUri(config),
    state,
    scope: scopeStringForTier(config.currentTier),
    response_type: "code",
  });
  return NextResponse.redirect(
    `${META_OAUTH_DIALOG}?${dialogParams.toString()}`,
    303,
  );
}
