import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { decryptToken } from "@/lib/crypto";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig, META_GRAPH_BASE } from "@/lib/meta-app-config";

/**
 * POST /api/meta/manual-ig
 *
 * Manually attach an Instagram account that Meta's Graph API doesn't expose
 * through `owned_instagram_accounts` / `instagram_business_accounts` / etc.
 * Real-world case: an IG marked as `instagram-account-v2` in BM Settings
 * shows in the UI but never returns from any of the standard edges. The
 * operator can paste the IG user_id here and we save it after verifying:
 *
 *   1. The connected user's token CAN read the IG (`GET /{ig_user_id}`).
 *      If Meta returns an error, the token has no access — refusing to
 *      save prevents creating a row the agent can't actually use.
 *   2. The selected Ad Account has a BM — the manual IG inherits that BM's
 *      id so the existing filter (by business_id_meta) keeps it in scope
 *      when the operator picks that Ad Account.
 *
 * Form body:
 *   - connection_id: uuid (which OAuth connection this IG attaches to)
 *   - ig_user_id: numeric Meta IG user id
 *   - ad_account_id: optional; when present, business_id_meta is inferred
 *     from that ad account's BM
 */
const bodySchema = z.object({
  connection_id: z.string().uuid(),
  ig_user_id: z.string().regex(/^\d+$/, "IG user id must be numeric"),
  ad_account_id: z.string().regex(/^act_\d+$/).optional(),
  /** Optional operator-supplied username — used when Meta refuses the
   *  direct `/{ig_id}` read (which it always does for v2 BM-only IGs). */
  username: z.string().trim().min(1).max(60).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const parsed = bodySchema.safeParse({
    connection_id: form.get("connection_id"),
    ig_user_id: form.get("ig_user_id"),
    ad_account_id: form.get("ad_account_id") || undefined,
    username: form.get("username") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  let config;
  try {
    config = loadMetaAppConfig();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "config" },
      { status: 500 },
    );
  }

  const db = getDataClient();
  const wa = await db.getConnectionWithAssets(parsed.data.connection_id);
  if (!wa) {
    return NextResponse.json(
      { error: "connection_not_found" },
      { status: 404 },
    );
  }

  const userToken = decryptToken(wa.connection.long_lived_token_encrypted);

  // Username resolution. Order of preference:
  //   1. Operator-supplied (most reliable for v2 BM-only IGs)
  //   2. Meta `/{ig_id}?fields=username` — typically fails for v2 IGs but
  //      worth one try in case Meta exposes some IGs that way.
  let username: string | null = parsed.data.username ?? null;
  if (!username) {
    try {
      const url = `${META_GRAPH_BASE}/${parsed.data.ig_user_id}?fields=id,username&access_token=${userToken}`;
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as {
        username?: string;
        error?: { message: string };
      };
      if (res.ok && !body.error && body.username) {
        username = body.username;
      } else {
        console.warn(
          `[manual-ig] cannot auto-fetch username for ${parsed.data.ig_user_id}: ${body.error?.message ?? `HTTP ${res.status}`}`,
        );
      }
    } catch (e) {
      console.warn(
        `[manual-ig] network error reading IG ${parsed.data.ig_user_id}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  // 2. Infer BM from the named ad account (if provided), else from any
  // selected ad account on this connection.
  let bmId: string | null = null;
  const targetAd =
    (parsed.data.ad_account_id &&
      wa.adAccounts.find(
        (a) => a.ad_account_id === parsed.data.ad_account_id,
      )) ||
    wa.adAccounts.find((a) => a.selected);
  if (targetAd) bmId = targetAd.business_id_meta;

  await db.upsertIgAccount({
    connection_id: wa.connection.id,
    ig_user_id: parsed.data.ig_user_id,
    username,
    linked_page_id: null,
    business_id_meta: bmId,
  });

  const origin = config.publicOrigin;
  return NextResponse.redirect(`${origin}/integrations?selected=ig`, 303);
}
