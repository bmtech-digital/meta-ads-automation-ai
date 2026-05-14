import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ACTIVE_BUSINESS_COOKIE,
  ACTIVE_BUSINESS_COOKIE_OPTIONS,
  getActiveBusiness,
} from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig } from "@/lib/meta-app-config";

/**
 * POST /api/meta/select
 *
 * Operator picks which Page / IG / Ad Account to operate against. Form body:
 *   - connection_id: uuid
 *   - asset_kind: 'page' | 'ig' | 'ad_account'
 *   - asset_id: the Meta id (page_id / ig_user_id / ad_account_id)
 *
 * Behavior per kind:
 *   - `ad_account` — switches the *active business* via cookie. Each ad
 *     account has its own business row (one created per discovered ad
 *     account at OAuth time, or lazily on first pick here). Switching the
 *     active business propagates to every page that calls
 *     `getActiveBusiness()` — approvals, gallery, knowledge, campaigns, etc.
 *   - `page` — updates the *active business's* meta_page_id (per-business
 *     Page choice). Falls back to no-op if no active business.
 *   - `ig` — multi-select. Form sends `selected=true|false`; the route sets
 *     that one IG's flag without disturbing other selected IGs. Per-task IG
 *     targeting (which IG a specific post lands on) is picked at proposal
 *     time, not here.
 *
 * Redirects back to /integrations with ?selected=<kind>.
 */
const bodySchema = z.object({
  connection_id: z.string().uuid(),
  asset_kind: z.enum(["page", "ig", "ad_account"]),
  asset_id: z.string().min(1),
  // Only consulted for `ig`. Optional for backwards compat — defaults to true
  // (i.e. "select this one"), preserving the prior single-select call shape.
  selected: z.enum(["true", "false"]).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData();
  const parsed = bodySchema.safeParse({
    connection_id: form.get("connection_id"),
    asset_kind: form.get("asset_kind"),
    asset_id: form.get("asset_id"),
    selected: form.get("selected") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const db = getDataClient();
  const { connection_id, asset_kind, asset_id, selected } = parsed.data;

  const withAssets = await db.getConnectionWithAssets(connection_id);
  if (!withAssets) {
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  }

  // META_PUBLIC_ORIGIN keeps redirects on the host-visible port (3100), not
  // the container-internal one (3000).
  let origin: string;
  try {
    origin = loadMetaAppConfig().publicOrigin;
  } catch {
    origin = new URL(req.url).origin;
  }

  if (asset_kind === "ad_account") {
    // Switch the active business to the one that owns this ad account.
    // Auto-provision if needed (covers the race where the operator picks
    // before OAuth callback's auto-provision step persists).
    const adRow = withAssets.adAccounts.find(
      (a) => a.ad_account_id === asset_id,
    );
    if (!adRow) {
      return NextResponse.json(
        { error: "ad_account_not_in_connection" },
        { status: 404 },
      );
    }
    let business = await db.findBusinessByAdAccountId(asset_id);
    if (!business) {
      business = await db.createBusinessForAdAccount({
        ad_account_id: asset_id,
        name: adRow.account_name ?? asset_id,
        timezone: adRow.timezone_name,
      });
    }
    const res = NextResponse.redirect(
      `${origin}/integrations?selected=ad_account`,
      303,
    );
    res.cookies.set(
      ACTIVE_BUSINESS_COOKIE,
      business.id,
      ACTIVE_BUSINESS_COOKIE_OPTIONS,
    );
    return res;
  }

  if (asset_kind === "page") {
    const active = await getActiveBusiness();
    if (active) {
      await db.setBusinessMetaIds(active.id, { page_id: asset_id });
    }
    // Keep the legacy meta_pages.selected flag in sync for the integrations
    // UI's "active" highlight under each BM group.
    await db.setSelectedPage(connection_id, asset_id);
    return NextResponse.redirect(
      `${origin}/integrations?selected=page`,
      303,
    );
  }

  // asset_kind === "ig" — multi-select toggle
  const desired = selected === "false" ? false : true;
  await db.setIgAccountSelected(connection_id, asset_id, desired);
  return NextResponse.redirect(`${origin}/integrations?selected=ig`, 303);
}
