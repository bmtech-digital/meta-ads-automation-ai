import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { decryptToken } from "@/lib/crypto";
import { getDataClient } from "@/lib/db";
import { META_GRAPH_BASE } from "@/lib/meta-app-config";

/**
 * POST /api/meta/debug-ig
 *
 * Diagnostic: try many possible endpoints to discover the user's Instagram
 * accounts, return whatever Meta sends back. Used to figure out why
 * `owned_instagram_accounts` returns 1 account when the Business Manager
 * UI shows 2 — it's possible Meta exposes the missing IG only via a
 * different edge or field expansion.
 *
 * Returns one JSON blob per endpoint tried so the operator can eyeball
 * which surface actually has the second IG.
 */
const bodySchema = z.object({ connection_id: z.string().uuid() });

async function probeRaw(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData();
  const parsed = bodySchema.safeParse({ connection_id: form.get("connection_id") });
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const db = getDataClient();
  const wa = await db.getConnectionWithAssets(parsed.data.connection_id);
  if (!wa)
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  const token = decryptToken(wa.connection.long_lived_token_encrypted);
  const bmIds = Array.from(
    new Set(
      [
        ...wa.adAccounts.map((a) => a.business_id_meta),
        ...wa.pages.map((p) => p.business_id_meta),
      ].filter(Boolean) as string[],
    ),
  );

  const probes: Record<string, unknown> = {};

  // BM-level
  for (const bm of bmIds) {
    for (const edge of [
      "owned_instagram_accounts",
      "instagram_business_accounts",
      "client_instagram_accounts",
      "instagram_accounts",
    ]) {
      const url = `${META_GRAPH_BASE}/${bm}/${edge}?fields=id,username&limit=200&access_token=${token}`;
      probes[`bm:${bm}/${edge}`] = await probeRaw(url);
    }
  }

  // User-level
  for (const fields of [
    "instagram_business_accounts",
    "businesses{owned_instagram_accounts{id,username}}",
    "businesses{instagram_business_accounts{id,username}}",
    "accounts{instagram_business_account{id,username}}",
  ]) {
    const url = `${META_GRAPH_BASE}/me?fields=${encodeURIComponent(fields)}&access_token=${token}`;
    probes[`me?fields=${fields}`] = await probeRaw(url);
  }

  // Ad-account level — subfields
  for (const a of wa.adAccounts) {
    for (const fields of [
      "instagram_actor_id",
      "connected_instagram_accounts{id,username}",
      "promoted_instagram_accounts{id,username}",
      "instagram_accounts{id,username}",
    ]) {
      const url = `${META_GRAPH_BASE}/${a.ad_account_id}?fields=${encodeURIComponent(fields)}&access_token=${token}`;
      probes[`ad-subfield:${a.ad_account_id}?fields=${fields}`] = await probeRaw(url);
    }
  }

  // Ad-account level — direct edges (different API surface from subfields).
  for (const a of wa.adAccounts) {
    for (const edge of [
      "instagram_accounts",
      "connected_instagram_accounts",
      "promoted_objects",
      "promoted_pages",
      "promotable_pages",
      "promote_pages",
    ]) {
      const url = `${META_GRAPH_BASE}/${a.ad_account_id}/${edge}?fields=id,username,name&limit=200&access_token=${token}`;
      probes[`ad-edge:${a.ad_account_id}/${edge}`] = await probeRaw(url);
    }
  }

  // BM-level — direct edges
  for (const bm of bmIds) {
    for (const edge of [
      "owned_pages",
      "client_pages",
      "owned_ad_accounts",
      "client_ad_accounts",
    ]) {
      const url = `${META_GRAPH_BASE}/${bm}/${edge}?fields=id,username,name&limit=200&access_token=${token}`;
      probes[`bm-edge:${bm}/${edge}`] = await probeRaw(url);
    }
  }

  return NextResponse.json(
    { token_fingerprint: token.slice(0, 6) + "...", probes },
    { status: 200 },
  );
}
