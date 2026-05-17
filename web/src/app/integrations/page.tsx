import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { SubNav, SETTINGS_GROUP_ITEMS } from "@/components/sub-nav";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type {
  ConnectionWithAssets,
  MetaAdAccountRow,
  MetaIgAccountRow,
  MetaPageRow,
} from "@/lib/db/types";
import {
  checkReadiness,
  META_CAPABILITIES,
  type CapabilityId,
  type ReadinessStatus,
} from "@/lib/meta-capabilities";
import { buildReadinessInput } from "@/lib/meta-readiness-input";
import {
  tokenExpiryState,
  tokenStateLabelHe,
  tokenStateStyles,
} from "@/lib/token-expiry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "אינטגרציות" };

const ERROR_MESSAGES: Record<string, string> = {
  missing_code_or_state: "התקבל callback בלי code או state — נסה שוב",
  invalid_state: "state לא תקין (HMAC נכשל)",
  expired_state: "state פג (יותר מ-10 דקות עברו) — לחץ שוב על התחבר",
  state_already_used: "state כבר נצרך (אולי לחיצה כפולה?)",
  state_business_mismatch: "אי-התאמה בין state לעסק — נסה שוב",
  debug_token_invalid: "Meta דחתה את הטוקן ב-debug_token",
  user_denied: "סירבת לאשר הרשאות",
  access_denied: "סירבת לאשר הרשאות",
};

function explainError(err: string | null): string | null {
  if (!err) return null;
  return ERROR_MESSAGES[err] ?? `שגיאה: ${err}`;
}

function readinessHe(status: ReadinessStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "ready":
      return {
        label: "מוכן",
        className: "bg-emerald-100 text-emerald-900 border-emerald-300",
      };
    case "future_only":
      return {
        label: "עתידי",
        className: "bg-slate-100 text-slate-800 border-slate-300",
      };
    case "needs_permission":
      return {
        label: "חסרות הרשאות",
        className: "bg-amber-100 text-amber-900 border-amber-300",
      };
    case "needs_asset":
      return {
        label: "צריך לבחור נכס",
        className: "bg-amber-100 text-amber-900 border-amber-300",
      };
    case "needs_role":
      return {
        label: "אין הרשאת ניהול",
        className: "bg-red-100 text-red-900 border-red-300",
      };
    case "needs_internal_data":
      return {
        label: "חסר מידע פנימי",
        className: "bg-amber-100 text-amber-900 border-amber-300",
      };
    case "wrong_mode":
      return {
        label: "לא במצב המתאים",
        className: "bg-slate-100 text-slate-800 border-slate-300",
      };
    case "blocked":
      return {
        label: "חסום (Pixel/CAPI)",
        className: "bg-red-100 text-red-900 border-red-300",
      };
    case "expired":
      return {
        label: "פג",
        className: "bg-red-100 text-red-900 border-red-300",
      };
    case "revoked":
      return {
        label: "בוטל",
        className: "bg-red-100 text-red-900 border-red-300",
      };
  }
}

/**
 * Per UX decision: when there's exactly one option of a kind and nothing is
 * selected yet, auto-select it server-side so the picker doesn't need to
 * render an empty state. Idempotent — re-running on an already-selected
 * group is a no-op.
 *
 * Side effect: when we auto-select a Page or Ad Account, also mirror to
 * `businesses.meta_page_id` / `meta_ad_account_id` so the rest of the app
 * (dashboard, history, campaigns) picks up the change without needing a
 * separate UI step.
 */
async function normalizeSelections(
  db: ReturnType<typeof getDataClient>,
  withAssets: ConnectionWithAssets,
): Promise<ConnectionWithAssets> {
  const { connection, pages, igAccounts, adAccounts } = withAssets;
  const tasks: Promise<void>[] = [];
  if (pages.length === 1 && !pages[0].selected) {
    tasks.push(db.setSelectedPage(connection.id, pages[0].page_id));
    tasks.push(
      db.setBusinessMetaIds(connection.business_id, {
        page_id: pages[0].page_id,
      }),
    );
  }
  // IG is multi-select; auto-pick only when no IG is selected yet and there's
  // exactly one option. Multi-IG setups require the operator to opt-in
  // explicitly (toggle per row) so we don't surprise them by enabling all.
  if (
    igAccounts.length === 1 &&
    !igAccounts[0].selected
  ) {
    tasks.push(
      db.setIgAccountSelected(connection.id, igAccounts[0].ig_user_id, true),
    );
  }
  if (adAccounts.length === 1 && !adAccounts[0].selected) {
    tasks.push(
      db.setSelectedAdAccount(connection.id, adAccounts[0].ad_account_id),
    );
    tasks.push(
      db.setBusinessMetaIds(connection.business_id, {
        ad_account_id: adAccounts[0].ad_account_id,
      }),
    );
  }
  if (tasks.length === 0) return withAssets;
  await Promise.all(tasks);
  const refreshed = await db.getConnectionWithAssets(connection.id);
  return refreshed ?? withAssets;
}

/**
 * Filter Pages to those that share a Business Manager with the selected
 * Ad Account. Strict — when the Ad Account has a BM and no Pages match,
 * we return [] so the UI can render an empty state ("no Pages in this Ad
 * Account's BM — try סנכרן"). We do NOT fall back to "show all" because
 * that defeats the purpose: the user picked an Ad Account to scope the
 * Pages, not to see everything.
 *
 * Exception: if the Ad Account itself has no BM (personal account), we
 * can't filter — return all. Personal Ad Accounts aren't scoped.
 */
function filterPagesByAdAccount(
  pages: MetaPageRow[],
  selectedAdAccount: MetaAdAccountRow | undefined,
): MetaPageRow[] {
  if (!selectedAdAccount?.business_id_meta) return pages;
  return pages.filter(
    (p) => p.business_id_meta === selectedAdAccount.business_id_meta,
  );
}

/**
 * Filter IG accounts to those in the selected Ad Account's Business Manager.
 * Uses each IG's own `business_id_meta` — which is populated either from the
 * linked Page's BM or from `/{bm}/owned_instagram_accounts` for BM-owned IGs
 * that don't have a Page link. This catches IGs that the per-Page discovery
 * missed.
 *
 * Personal ad accounts (no BM) can't filter — return all IG accounts.
 */
function filterIgByAdAccount(
  igAccounts: MetaIgAccountRow[],
  selectedAdAccount: MetaAdAccountRow | undefined,
): MetaIgAccountRow[] {
  if (!selectedAdAccount?.business_id_meta) return igAccounts;
  return igAccounts.filter(
    (ig) => ig.business_id_meta === selectedAdAccount.business_id_meta,
  );
}

/**
 * After the user changes the selected Ad Account, the previously-selected
 * Page may no longer match the new Ad Account's BM. This helper cascades
 * the selection: if the currently-selected Page is filtered out, switch
 * to the first available Page in the filtered list. Same for IG.
 *
 * Runs inside the integrations page render — idempotent because it only
 * acts when the current selection is invalid for the new context.
 */
async function cascadeSelectionsAfterAdAccountChange(
  db: ReturnType<typeof getDataClient>,
  withAssets: ConnectionWithAssets,
): Promise<ConnectionWithAssets> {
  const { connection, pages, igAccounts, adAccounts } = withAssets;
  const selectedAd = adAccounts.find((a) => a.selected);
  if (!selectedAd) return withAssets;

  const visiblePages = filterPagesByAdAccount(pages, selectedAd);
  const visiblePageIds = new Set(visiblePages.map((p) => p.id));
  const selectedPage = pages.find((p) => p.selected);
  const pageSelectionStillValid =
    !selectedPage || visiblePageIds.has(selectedPage.id);

  const tasks: Promise<void>[] = [];
  if (!pageSelectionStillValid && visiblePages.length > 0) {
    const next = visiblePages[0];
    tasks.push(db.setSelectedPage(connection.id, next.page_id));
    tasks.push(
      db.setBusinessMetaIds(connection.business_id, { page_id: next.page_id }),
    );
  }

  // IG is multi-select. When the BM changes, drop any selected IGs that
  // belong to a different BM (they're not addressable in the new context),
  // and if nothing remains selected, auto-pick the first visible one so the
  // capability check has at least one target.
  const visibleIg = filterIgByAdAccount(igAccounts, selectedAd);
  const visibleIgIds = new Set(visibleIg.map((i) => i.ig_user_id));
  const selectedIgs = igAccounts.filter((i) => i.selected);
  const orphanedIgs = selectedIgs.filter(
    (i) => !visibleIgIds.has(i.ig_user_id),
  );
  for (const orphan of orphanedIgs) {
    tasks.push(db.setIgAccountSelected(connection.id, orphan.ig_user_id, false));
  }
  const remainingSelected = selectedIgs.length - orphanedIgs.length;
  if (remainingSelected === 0 && visibleIg.length > 0) {
    tasks.push(
      db.setIgAccountSelected(connection.id, visibleIg[0].ig_user_id, true),
    );
  }

  if (tasks.length === 0) return withAssets;
  await Promise.all(tasks);
  const refreshed = await db.getConnectionWithAssets(connection.id);
  return refreshed ?? withAssets;
}

/** True if any Page is missing business_id_meta — surface as "click sync" hint. */
function pagesNeedSync(pages: MetaPageRow[]): boolean {
  return pages.some((p) => p.business_id_meta === null);
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    error?: string;
    selected?: string;
    synced?: string;
  }>;
}) {
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/integrations");

  const { connected, disconnected, error, selected, synced } =
    await searchParams;
  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/settings">
        <SubNav items={SETTINGS_GROUP_ITEMS} />
        <PageHeader eyebrow="אינטגרציות" title="חיבור Meta" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>
              הרץ את המיגרציות ו-`seed_local.py` לפני חיבור.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // The active business's connection is found via its ad_account_id, not its
  // business_id, because multi-business setups share one OAuth handshake
  // across many businesses (one per client ad account). Fall back to
  // `getActiveConnectionForBusiness` if the lookup-by-ad-account misses —
  // covers the brief window before OAuth callback's auto-provision step
  // creates the per-ad-account business rows.
  const connection =
    (await db.getConnectionByAdAccountId(business.meta_ad_account_id)) ??
    (await db.getActiveConnectionForBusiness(business.id));
  let withAssets = connection
    ? await db.getConnectionWithAssets(connection.id)
    : null;
  if (withAssets) {
    withAssets = await normalizeSelections(db, withAssets);
    // Cascade: if the selected Ad Account changed, re-pick Page/IG to match
    // its BM so the UI doesn't show a "selected" item that's filtered out.
    withAssets = await cascadeSelectionsAfterAdAccountChange(db, withAssets);
  }
  const knowledge = await db.getBusinessKnowledge(business.id);

  const readinessInput = buildReadinessInput({
    business,
    withAssets,
    knowledge,
  });
  const readiness = checkReadiness(readinessInput);

  // Token state derives from the actual connection's expiry, not the
  // business column — auto-provisioned businesses may have no expiry mirrored
  // on `business.meta_access_token_expires_at`, but the connection row is the
  // authoritative source for "are we connected".
  const tokenState = tokenExpiryState({
    ...business,
    meta_access_token_expires_at:
      connection?.token_expires_at ?? business.meta_access_token_expires_at,
  });
  const errMsg = explainError(error ?? null);

  return (
    <Shell active="/settings">
      <SubNav items={SETTINGS_GROUP_ITEMS} />
      <PageHeader
        eyebrow="אינטגרציות"
        title="חיבור Meta"
        subtitle="חבר את חשבון פייסבוק/אינסטגרם/מנהל המודעות — פעם אחת."
      />

      <div className="flex flex-col gap-6">
        {/* Status banners */}
        {connected ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
            ✓ החיבור הושלם בהצלחה
          </div>
        ) : null}
        {disconnected ? (
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900">
            החיבור נותק
          </div>
        ) : null}
        {selected ? (
          <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
            הבחירה נשמרה
          </div>
        ) : null}
        {synced ? (
          <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
            ✓ הנכסים סונכרנו מ-Meta
          </div>
        ) : null}
        {errMsg ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900">
            {errMsg}
          </div>
        ) : null}

        {/* Connected → asset picker per Business Manager. Otherwise → Connect CTA. */}
        {connection && withAssets ? (
          <ConnectedCard
            connection={connection}
            withAssets={withAssets}
            tokenLabel={tokenStateLabelHe(tokenState)}
            tokenClassName={tokenStateStyles(tokenState)}
          />
        ) : (
          <NotConnectedCard businessId={business.id} />
        )}

        {/* Readiness dashboard */}
        <div>
          <SectionHeader
            title="כשירות יכולות"
            description="מה הסוכן יכול לעשות כרגע, ומה חסר כדי להפעיל את היתר"
          />
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {(Object.keys(readiness) as CapabilityId[]).map((id) => {
                  const r = readiness[id];
                  const ui = readinessHe(r.status);
                  return (
                    <div
                      key={id}
                      className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium">
                          {META_CAPABILITIES[id].label}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground">
                          {r.reason}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {id === "verifyPixelCAPI" && r.status !== "ready" ? (
                          <form method="POST" action="/api/meta/verify-pixel-capi">
                            <Button type="submit" size="sm" variant="outline">
                              בדוק עכשיו
                            </Button>
                          </form>
                        ) : null}
                        <Badge className={ui.className}>{ui.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function NotConnectedCard({ businessId }: { businessId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>עוד לא מחובר</CardTitle>
        <CardDescription>
          לחץ &quot;התחבר ל-Meta&quot; כדי לאשר גישה לעמודי פייסבוק, חשבון
          אינסטגרם עסקי, ולחשבון המודעות. החיבור נשמר מוצפן — לא תצטרך לחזור על
          זה כל פעם.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="POST" action="/api/meta/oauth/start">
          <input type="hidden" name="business_id" value={businessId} />
          <Button type="submit" size="lg">
            התחבר ל-Meta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type BmGroup = {
  bmId: string | null; // null = "personal" ad accounts pseudo-group
  adAccounts: MetaAdAccountRow[];
  pages: MetaPageRow[];
  igAccounts: MetaIgAccountRow[];
};

function groupByBm(withAssets: ConnectionWithAssets): BmGroup[] {
  const keys = new Set<string | null>();
  for (const a of withAssets.adAccounts) keys.add(a.business_id_meta);
  for (const p of withAssets.pages) keys.add(p.business_id_meta);
  for (const ig of withAssets.igAccounts) keys.add(ig.business_id_meta);

  const groups: BmGroup[] = [];
  // BMs with at least one asset come first, alphabetized by bm id for stable order.
  const bmKeys = Array.from(keys).filter((k): k is string => k !== null).sort();
  for (const bmId of bmKeys) {
    groups.push({
      bmId,
      adAccounts: withAssets.adAccounts.filter(
        (a) => a.business_id_meta === bmId,
      ),
      pages: withAssets.pages.filter((p) => p.business_id_meta === bmId),
      igAccounts: withAssets.igAccounts.filter(
        (ig) => ig.business_id_meta === bmId,
      ),
    });
  }
  // Personal (no BM) assets — only ad accounts in practice, but list any orphan.
  const personalAd = withAssets.adAccounts.filter(
    (a) => a.business_id_meta === null,
  );
  const personalPages = withAssets.pages.filter(
    (p) => p.business_id_meta === null,
  );
  const personalIg = withAssets.igAccounts.filter(
    (ig) => ig.business_id_meta === null,
  );
  if (
    personalAd.length > 0 ||
    personalPages.length > 0 ||
    personalIg.length > 0
  ) {
    groups.push({
      bmId: null,
      adAccounts: personalAd,
      pages: personalPages,
      igAccounts: personalIg,
    });
  }
  return groups;
}

function ConnectedCard({
  connection,
  withAssets,
  tokenLabel,
  tokenClassName,
}: {
  connection: { id: string; meta_user_name: string | null; status: string };
  withAssets: ConnectionWithAssets;
  tokenLabel: string;
  tokenClassName: string;
}) {
  const groups = groupByBm(withAssets);
  const activeAd = withAssets.adAccounts.find((a) => a.selected);
  const activeBmId = activeAd?.business_id_meta ?? null;
  const needsSync = pagesNeedSync(withAssets.pages);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>מחובר ל-Meta</span>
          <Badge className={tokenClassName}>{tokenLabel}</Badge>
        </CardTitle>
        <CardDescription>
          משתמש Meta:{" "}
          <span className="font-medium">
            {connection.meta_user_name ?? "—"}
          </span>
          {" · "}
          סטטוס: <span className="font-medium">{connection.status}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {needsSync ? <SyncHint connectionId={connection.id} /> : null}

        <div className="text-[13.5px] text-muted-foreground">
          להלן כל הנכסים שתחת השליטה שלך ב-Meta, מקובצים לפי Business Manager.
          Page ו-Instagram לכל קמפיין נבחרים בעת יצירת קמפיין, לא כאן.
        </div>

        {groups.map((group) => (
          <BmGroupCard
            key={group.bmId ?? "personal"}
            group={group}
            connectionId={connection.id}
            isActive={
              group.bmId === activeBmId ||
              (group.bmId === null && activeBmId === null && activeAd !== undefined)
            }
            activeAdAccountId={activeAd?.ad_account_id ?? null}
          />
        ))}

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <form method="POST" action="/api/meta/sync">
            <input type="hidden" name="connection_id" value={connection.id} />
            <Button type="submit" variant="outline" size="sm">
              סנכרן נכסים מ-Meta
            </Button>
          </form>
          <form method="POST" action="/api/meta/oauth/disconnect">
            <input type="hidden" name="connection_id" value={connection.id} />
            <Button type="submit" variant="outline" size="sm">
              נתק חיבור
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function BmGroupCard({
  group,
  connectionId,
  isActive,
  activeAdAccountId,
}: {
  group: BmGroup;
  connectionId: string;
  isActive: boolean;
  activeAdAccountId: string | null;
}) {
  const bmHeader =
    group.bmId === null
      ? "חשבונות מודעות אישיים (ללא Business Manager)"
      : `Business Manager · ${group.bmId}`;
  return (
    <div
      className={
        "rounded-xl p-4 transition-all duration-200 " +
        (isActive ? "glass-panel" : "glass-surface")
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">{bmHeader}</div>
          {isActive ? (
            <div className="mt-0.5 text-[11.5px] text-brand-600 dark:text-brand-400">
              ה-BM הפעיל — הסוכן פועל בתוכו
            </div>
          ) : null}
        </div>
        {isActive ? (
          <Badge className="border-brand-300 bg-brand-100 text-brand-900">
            פעיל
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AssetColumn title={`חשבונות מודעות · ${group.adAccounts.length}`}>
          {group.adAccounts.length === 0 ? (
            <EmptyLine />
          ) : (
            group.adAccounts.map((a) => (
              <AdAccountRow
                key={a.ad_account_id}
                ad={a}
                connectionId={connectionId}
                isActive={a.ad_account_id === activeAdAccountId}
              />
            ))
          )}
        </AssetColumn>
        <AssetColumn title={`עמודי פייסבוק · ${group.pages.length}`}>
          {group.pages.length === 0 ? (
            <EmptyLine />
          ) : (
            group.pages.map((p) => (
              <PageRow
                key={p.page_id}
                page={p}
                connectionId={connectionId}
                isActive={p.selected}
              />
            ))
          )}
        </AssetColumn>
        <AssetColumn title={`חשבונות Instagram · ${group.igAccounts.length}`}>
          {group.igAccounts.length === 0 ? (
            <EmptyLine />
          ) : (
            group.igAccounts.map((ig) => (
              <IgRow
                key={ig.ig_user_id}
                ig={ig}
                connectionId={connectionId}
                isActive={ig.selected}
              />
            ))
          )}
          {group.bmId !== null ? (
            <ManualIgForm
              connectionId={connectionId}
              adAccountId={
                isActive
                  ? activeAdAccountId
                  : group.adAccounts[0]?.ad_account_id ?? null
              }
            />
          ) : null}
        </AssetColumn>
      </div>
    </div>
  );
}

function AssetColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function AdAccountRow({
  ad,
  connectionId,
  isActive,
}: {
  ad: MetaAdAccountRow;
  connectionId: string;
  isActive: boolean;
}) {
  const subtitle =
    [ad.currency, ad.timezone_name].filter(Boolean).join(" · ") || null;
  return (
    <form
      method="POST"
      action="/api/meta/select"
      className={
        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[13px] " +
        (isActive
          ? "border-brand-400 bg-brand-100/40 dark:bg-brand-400/10"
          : "border-border bg-background")
      }
    >
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="asset_kind" value="ad_account" />
      <input type="hidden" name="asset_id" value={ad.ad_account_id} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {ad.account_name ?? ad.ad_account_id}
        </div>
        {subtitle ? (
          <div className="truncate text-[11.5px] text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {isActive ? (
        <Badge className="border-brand-300 bg-brand-100 text-brand-900">
          פעיל
        </Badge>
      ) : (
        <Button type="submit" variant="outline" size="sm">
          הפעל
        </Button>
      )}
    </form>
  );
}

function PageRow({
  page,
  connectionId,
  isActive,
}: {
  page: MetaPageRow;
  connectionId: string;
  isActive: boolean;
}) {
  return (
    <form
      method="POST"
      action="/api/meta/select"
      className={
        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[13px] " +
        (isActive
          ? "border-brand-400 bg-brand-100/40 dark:bg-brand-400/10"
          : "border-border bg-background")
      }
    >
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="asset_kind" value="page" />
      <input type="hidden" name="asset_id" value={page.page_id} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{page.page_name}</div>
        {page.category ? (
          <div className="truncate text-[11.5px] text-muted-foreground">
            {page.category}
          </div>
        ) : null}
      </div>
      {isActive ? (
        <Badge className="border-brand-300 bg-brand-100 text-brand-900">
          פעיל
        </Badge>
      ) : (
        <Button type="submit" variant="outline" size="sm">
          הפעל
        </Button>
      )}
    </form>
  );
}

function IgRow({
  ig,
  connectionId,
  isActive,
}: {
  ig: MetaIgAccountRow;
  connectionId: string;
  isActive: boolean;
}) {
  const subtitle =
    ig.linked_page_id === null && ig.username !== null
      ? "BM-owned (ידני / לא מקושר ל-Page)"
      : null;
  return (
    <form
      method="POST"
      action="/api/meta/select"
      className={
        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[13px] " +
        (isActive
          ? "border-brand-400 bg-brand-100/40 dark:bg-brand-400/10"
          : "border-border bg-background")
      }
    >
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="asset_kind" value="ig" />
      <input type="hidden" name="asset_id" value={ig.ig_user_id} />
      <input
        type="hidden"
        name="selected"
        value={isActive ? "false" : "true"}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {ig.username ?? ig.ig_user_id}
        </div>
        {subtitle ? (
          <div className="truncate text-[11.5px] text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      <Button
        type="submit"
        variant={isActive ? "secondary" : "outline"}
        size="sm"
      >
        {isActive ? "כבה" : "הפעל"}
      </Button>
    </form>
  );
}

function EmptyLine() {
  return (
    <div className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-[12px] text-muted-foreground">
      אין נכסים בקטגוריה זו
    </div>
  );
}

function SyncHint({ connectionId }: { connectionId: string }) {
  return (
    <form
      method="POST"
      action="/api/meta/sync"
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900"
    >
      <input type="hidden" name="connection_id" value={connectionId} />
      <span className="text-[13px]">
        כדי לסנן עמודים ו-Instagram לפי חשבון המודעות, צריך לסנכרן את הנכסים
        מ-Meta פעם אחת (נטען Business Manager לכל עמוד).
      </span>
      <Button type="submit" size="sm">
        סנכרן
      </Button>
    </form>
  );
}

function ManualIgForm({
  connectionId,
  adAccountId,
}: {
  connectionId: string;
  adAccountId: string | null;
}) {
  return (
    <details className="rounded-md border border-dashed border-border bg-card/40 px-2.5 py-2 text-[12px]">
      <summary className="cursor-pointer select-none text-muted-foreground">
        + הוסף Instagram ידנית
      </summary>
      <form
        method="POST"
        action="/api/meta/manual-ig"
        className="mt-2 flex flex-col gap-2"
      >
        <input type="hidden" name="connection_id" value={connectionId} />
        {adAccountId ? (
          <input type="hidden" name="ad_account_id" value={adAccountId} />
        ) : null}
        <input
          name="ig_user_id"
          required
          inputMode="numeric"
          pattern="\d+"
          placeholder="Instagram user ID (17841...)"
          dir="ltr"
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          name="username"
          type="text"
          placeholder="username"
          aria-label="username (אופציונלי)"
          dir="ltr"
          className="h-8 rounded-md border border-input bg-background px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="outline">
          הוסף
        </Button>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          רלוונטי כשMeta API לא חושפת חשבון IG שכן קיים ב-Business Manager
          (BM-owned ללא Page-link). business.facebook.com → Settings →
          חשבונות אינסטגרם → ה-ID.
        </span>
      </form>
    </details>
  );
}

