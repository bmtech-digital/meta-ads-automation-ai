import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig } from "@/lib/meta-app-config";
import {
  getInstagramAccountForPage,
  getMyAdAccounts,
  getMyPages,
  getOwnedInstagramAccounts,
  getPageProfile,
  MetaGraphError,
} from "@/lib/meta-graph";

/**
 * POST /api/meta/sync
 *
 * Re-fetch the asset list (Pages, IG, Ad Accounts) for an existing
 * connection. Used when:
 *   - The user grants additional Pages/Ad Accounts in Meta and wants them
 *     to appear in our UI
 *   - We add a new field to the schema (e.g. `business_id_meta` on Pages
 *     via migration 014) that needs backfilling from Graph for legacy rows
 *
 * Does NOT touch the connection's long-lived token or scopes — those only
 * change via /api/meta/oauth/callback (full re-auth).
 *
 * Form body: `connection_id=<uuid>`.
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
  const withAssets = await db.getConnectionWithAssets(parsed.data.connection_id);
  if (!withAssets) {
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  }
  const { connection } = withAssets;
  if (connection.status === "revoked") {
    return NextResponse.json({ error: "connection_revoked" }, { status: 409 });
  }

  const userToken = decryptToken(connection.long_lived_token_encrypted);

  try {
    const [pagesResult, adAccountsResult] = await Promise.allSettled([
      getMyPages(userToken),
      getMyAdAccounts(userToken),
    ]);
    const pages =
      pagesResult.status === "fulfilled" ? pagesResult.value : [];
    const adAccounts =
      adAccountsResult.status === "fulfilled" ? adAccountsResult.value : [];

    const pageRows = await Promise.all(
      pages.map((p) =>
        db.upsertPage({
          connection_id: connection.id,
          page_id: p.id,
          page_name: p.name,
          page_access_token_encrypted: encryptToken(p.access_token),
          category: p.category,
          tasks: p.tasks,
          business_id_meta: p.business_id,
        }),
      ),
    );

    // IG discovery — two paths combined:
    //   (a) per-Page: GET /{page_id}?fields=instagram_business_account
    //   (b) per-BM: GET /{bm_id}/owned_instagram_accounts
    // (b) catches IGs that are BM-owned but not linked to any Page. We dedupe
    // by ig_user_id; the upsert's COALESCE keeps the most informative fields.
    await Promise.all(
      pages.map(async (p, idx) => {
        try {
          const ig = await getInstagramAccountForPage({
            pageId: p.id,
            pageAccessToken: p.access_token,
          });
          if (ig) {
            await db.upsertIgAccount({
              connection_id: connection.id,
              ig_user_id: ig.ig_user_id,
              username: ig.username,
              linked_page_id: pageRows[idx].id,
              // Infer the IG's BM from the linked Page's BM.
              business_id_meta: pages[idx].business_id,
            });
          }
        } catch (e) {
          console.warn(
            `[meta.sync] IG resolution failed for page ${p.id}: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      }),
    );

    // BM-owned IG discovery. Enumerate the unique BMs from the ad accounts +
    // pages we just synced, then query each for its owned IG accounts.
    const bmIds = new Set<string>();
    for (const a of adAccounts) if (a.business_id) bmIds.add(a.business_id);
    for (const p of pages) if (p.business_id) bmIds.add(p.business_id);
    const bmOwnedLists = await Promise.all(
      Array.from(bmIds).map((bmId) =>
        getOwnedInstagramAccounts({ bmId, userToken }),
      ),
    );
    for (const list of bmOwnedLists) {
      for (const ig of list) {
        await db.upsertIgAccount({
          connection_id: connection.id,
          ig_user_id: ig.ig_user_id,
          username: ig.username,
          // BM-owned IGs may not have a linked Page in our discovery. The
          // upsert's COALESCE keeps a previously-set linked_page_id if a
          // per-Page sync already populated it.
          linked_page_id: null,
          business_id_meta: ig.business_id,
        });
      }
    }

    await Promise.all(
      adAccounts.map((a) =>
        db.upsertAdAccount({
          connection_id: connection.id,
          ad_account_id: a.id,
          account_name: a.name,
          currency: a.currency,
          timezone_name: a.timezone_name,
          user_role: a.user_role,
          business_id_meta: a.business_id,
        }),
      ),
    );

    // Auto-fill business_knowledge from the selected Page's profile (if a
    // Page is selected). Best-effort — failures don't block the sync.
    const refreshed = await db.getConnectionWithAssets(connection.id);
    const selectedPage = refreshed?.pages.find((p) => p.selected) ??
      refreshed?.pages[0];
    if (selectedPage) {
      const matching = pages.find((p) => p.id === selectedPage.page_id);
      if (matching) {
        try {
          const profile = await getPageProfile({
            pageId: matching.id,
            pageAccessToken: matching.access_token,
          });
          if (profile) {
            await db.autofillBusinessKnowledge(connection.business_id, {
              website_url: profile.website,
              service_regions: profile.country ? [profile.country] : null,
            });
          }
        } catch (e) {
          console.warn(
            `[meta.sync] autofill failed: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      }
    }

    const origin = config.publicOrigin;
    return NextResponse.redirect(`${origin}/integrations?synced=1`, 303);
  } catch (e) {
    const msg =
      e instanceof MetaGraphError
        ? `graph_${e.code ?? "unknown"}`
        : e instanceof Error
          ? e.message
          : "unknown";
    console.error("[meta.sync] failed:", e);
    const origin = config.publicOrigin;
    return NextResponse.redirect(`${origin}/integrations?error=${msg}`, 303);
  }
}
