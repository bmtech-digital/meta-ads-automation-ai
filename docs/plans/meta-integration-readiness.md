# Meta Integration + App Review Readiness

> **Status:** draft 2026-05-11 — Roi
> **Branch:** `meta-integration-readiness`
> **Goal:** ship a production-grade Meta integration that (a) lets Aiweon operate its own ad account with zero-touch token stability, (b) lets SaaS tenants connect their own Meta assets via OAuth, and (c) passes Meta App Review for the Marketing API + Pages + Instagram (FB Login path) use cases.
>
> Companion docs already in repo (do not duplicate, just link):
>
> - [`meta-app-review-submission.md`](meta-app-review-submission.md) — the submission packet
> - [`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md) + [`-he`](meta-app-review-privacy-policy-he.md)
> - [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md) + [`-he`](meta-app-review-data-deletion-he.md)
> - [`meta-app-review-data-usage-summary.md`](meta-app-review-data-usage-summary.md)
> - [`task-2.4-bemtech-bv.md`](task-2.4-bemtech-bv.md) — Business Verification
> - [`bemtech-bv-requirements.md`](bemtech-bv-requirements.md)
>
> Open question from `conversation-map.md`: ad-account switcher placement (1.11) — out of scope here, the integration is asset-agnostic.

---

## 0. Decisions captured (locked)

Recorded in `decisions-log.md` §1.12. Three blocking choices made before drafting this plan:

| # | Decision | Implication |
|---|---|---|
| 1 | **CRM scope = external hook only.** No `workspace` / `crm_account` / `crm_contact` tables in Campaigner. | Add `external_crm_ref jsonb` columns to `approvals`, `creative_gallery`, and the new connection tables so a downstream CRM can attach without schema churn. |
| 2 | **Tenancy = dual-path.** Aiweon's own ops use a **System User Token** (no expiry); future SaaS tenants connect via OAuth (long-lived user token, ~60 day rotation). Both paths coexist. | Schema must distinguish the two via `meta_auth_mode` (already in `businesses`). New `meta_connections` table for OAuth-based connections. UI exposes OAuth only when `auth_mode='user_token'`. |
| 3 | **Instagram login = FB Login + IG linked to Page.** | Single Graph code path (the one already in [`web/src/lib/meta.ts:505-517`](../../web/src/lib/meta.ts#L505-L517)). One App Review use case ("Instagram API with Facebook Login"). No `/me/instagram_accounts` direct-login flow. |

---

## 1. The two stability paths

The user-facing pain — "I don't want to reconnect every second" — is solved by **never operating prod from a User Token**, not by making the OAuth UX smoother.

### Path A — Aiweon (System User Token, no expiry)

| | |
|---|---|
| Token type | System User Token, generated in Business Manager |
| Expiry | Never (revoked only by removing the System User from BM) |
| Storage | GCP Secret Manager (`meta-token-aiweon`, per §1.1) |
| `businesses.meta_auth_mode` | `'system_user_token'` |
| `businesses.meta_access_token_expires_at` | `NULL` (UI shows "System User Token — ללא תפוגה") |
| OAuth UI shown? | **No** — irrelevant for this path |
| Page Access Tokens | Resolved on-demand via `/me/accounts` (existing cache, [`meta.ts:57-79`](../../web/src/lib/meta.ts#L57-L79)) and treated as non-expiring. |

This is the production path. Path B is built for SaaS + App Review demo, not for daily operation.

### Path B — SaaS tenant (OAuth + long-lived user token)

| | |
|---|---|
| Token type | Long-lived user access token (60 day expiry) |
| Expiry | 60 days from issuance. Extended automatically on each API call within the window (graceful sliding). |
| Storage | `meta_connections.long_lived_token_encrypted` (AES-256-GCM, key from Secret Manager) |
| `meta_auth_mode` on linked business | `'user_token'` |
| Token expiry warning | Existing `token-expiry.ts` (10d warning, 3d critical). |
| Reconnect | Triggered from UI when status flips to `expired`/`revoked` or 3-day critical hits. |

### Why both paths in one repo

Even if Aiweon never plans to onboard a tenant, **Meta App Review requires demonstrating the OAuth flow** with a test user. The reviewer expects to click "Connect Meta" and watch a normal user authorize. Building Path B is non-negotiable for getting `ads_management` granted in Advanced Access.

---

## 2. Data model — three new migrations

All migrations are additive. They never alter or drop existing `businesses` fields. Existing rows continue to work via `meta_auth_mode='system_user_token'` (Aiweon's row) or by linking a future tenant business to a new `meta_connections` row.

### 2.1 `011_meta_connections.sql`

Stores one row per (tenant business, Meta user) OAuth connection. Page / IG / Ad Account assets attach to a connection.

Tables:

- **`meta_connections`** — the OAuth handshake result. Columns: `id`, `business_id` FK, `meta_user_id` (Meta's `/me.id`), `meta_user_name`, `long_lived_token_encrypted`, `token_expires_at`, `granted_scopes text[]`, `granular_scopes jsonb` (per-asset scope map), `status` (`active|partial|expired|revoked`), `last_health_check_at`, `connected_by` (app user id), `external_crm_ref jsonb`, `created_at`, `updated_at`.
- **`meta_pages`** — Facebook Pages discovered for a connection. `id`, `connection_id` FK, `page_id`, `page_name`, `page_access_token_encrypted` (long-lived because derived from long-lived user token), `category`, `tasks text[]` (Page roles from Graph), `selected boolean` (the active one for this business), `external_crm_ref jsonb`.
- **`meta_ig_accounts`** — Instagram Business accounts linked to selected Pages. `id`, `connection_id` FK, `ig_user_id`, `username`, `linked_page_id` FK → `meta_pages.id`, `selected boolean`, `external_crm_ref jsonb`.
- **`meta_ad_accounts`** — discovered ad accounts. `id`, `connection_id` FK, `ad_account_id`, `account_name`, `currency`, `timezone_name`, `user_role` (from `/me/adaccounts?fields=user_role`), `business_id_meta` (BM owner, distinct from our `business_id`), `selected boolean`, `external_crm_ref jsonb`.
- **`meta_oauth_state`** — one-time-use CSRF state for OAuth callbacks. `state` (PK, HMAC token), `app_user_id`, `business_id`, `expires_at`, `consumed boolean`.

Indexes:

- `meta_connections (business_id, status)` — for "is this tenant connected?"
- `meta_pages (connection_id, selected) WHERE selected = true`
- `meta_oauth_state (expires_at) WHERE consumed = false` — for the cleanup cron.

### 2.2 `012_meta_api_audit.sql`

Every Meta API call writes one row. Required for (a) debugging, (b) GDPR data-deletion compliance ("what did you do with my data"), (c) rate-limit accounting.

Columns: `id`, `business_id`, `connection_id` (nullable for Path A), `capability` (e.g. `'publishInstagramContent'`), `mode` (`insight|draft|action`), `meta_endpoint`, `http_method`, `request_summary jsonb` (NOT raw payload — redacted), `response_status int`, `response_error jsonb`, `duration_ms`, `approval_id` (nullable; populated for action-mode calls), `created_at`.

Index: `(business_id, created_at DESC)` for the audit viewer; partial `(business_id) WHERE response_status >= 400` for failure dashboards.

### 2.3 `013_agent_mode_and_crm_hooks.sql`

Three small additions:

1. `businesses.agent_mode text NOT NULL DEFAULT 'draft' CHECK (agent_mode IN ('insight','draft','action'))` — the three-mode state machine. Default `draft` because that's the HITL invariant per [root CLAUDE.md](../../CLAUDE.md) ("agent proposes, human approves").
2. `approvals.external_crm_ref jsonb` — the external-CRM hook (decision §1.12 #1).
3. `creative_gallery.external_crm_ref jsonb` — same hook on the gallery side.

No data migration. New `agent_mode` defaults to `draft`. Existing rows continue to behave as before because the column is read-with-default by the agent.

---

## 3. Capability layer

A pure TS module at `web/src/lib/meta-capabilities.ts`. Three exports:

```ts
export const META_SCOPE_GROUPS: Record<string, string[]>
export const META_CAPABILITIES: Record<CapabilityId, CapabilitySpec>
export function checkReadiness(...): Record<CapabilityId, ReadinessReport>
```

### 3.1 Scope groups — corrected

```ts
{
  base: ["public_profile", "email"],

  facebookPagesRead:  ["pages_show_list", "pages_read_engagement"],
  facebookPagesManage: ["pages_manage_metadata"],          // moved out of read
  facebookPublish:    ["pages_manage_posts"],

  instagramBasic:     ["instagram_basic", "pages_show_list", "pages_read_engagement"],
  instagramPublish:   ["instagram_content_publish"],
  instagramInsights:  ["instagram_manage_insights"],

  adsRead:   ["ads_read"],
  adsManage: ["ads_management", "business_management"],

  whatsappFuture: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
}
```

`pages_manage_metadata` moved out of `facebookPagesRead` (it is a manage scope — needed for webhook config, not for reading posts).

### 3.2 Capability spec shape

```ts
interface CapabilitySpec {
  requiredScopes: string[];
  requiredAssets: AssetKind[];               // 'facebook_page' | 'instagram_business_account' | 'ad_account' | 'pixel'
  requiredInternalData?: InternalDataKind[]; // 'business_profile' | 'gallery_media' | 'campaign_history'
  modes: AgentMode[];                        // which of insight|draft|action allow this capability
  requiresUserApproval: boolean;
  tokenType: 'user' | 'page' | 'system_user';  // which token Graph wants
  metaAppReviewTier: 1 | 2 | 3 | 4 | null;   // §5 tiering
  blockedBy?: CapabilityId[];                // e.g. createOrUpdateMetaCampaign blocked by !verifyPixelCAPI
}
```

### 3.3 Capability catalog — what's in scope

| Capability | Tier | Mode | Token | Notes |
|---|---|---|---|---|
| `connectMetaAccount` | 1 | insight+ | user | `public_profile`, `email` |
| `listFacebookPages` | 1 | insight+ | user | `pages_show_list`, `pages_read_engagement` |
| `readInstagramBusinessAccount` | 1 | insight+ | page | resolved via Page token |
| `readPageInsights` | 1 | insight+ | page | `pages_read_engagement` |
| `readInstagramInsights` | 1 | insight+ | user+page | `instagram_manage_insights` |
| `readAdsPerformance` | 1 | insight+ | user | `ads_read` |
| `verifyPixelCAPI` | 1 | insight+ | user | gates `createOrUpdateMetaCampaign` and `publishInstagramContent`; reads `business_knowledge.tracking_verified` |
| `prepareCampaignDraft` | — | draft+ | — | uses `ads_read` for history. **Always writes to `approvals`, never executes.** |
| `publishFacebookPost` | 2 | action | page | `pages_manage_posts`. Requires `approvals` row in `approved` state. |
| `publishInstagramContent` | 2 | action | page | `instagram_content_publish`. Same approval gate. |
| `createOrUpdateMetaCampaign` | 3 | action | user | `ads_management` + `business_management`. Approval gate **+ verifyPixelCAPI gate**. |
| `whatsappMessagingFuture` | 4 | — | — | reserved, throws `notImplemented` |

### 3.4 Readiness check — pseudocode

```
for each capability:
  1. token: connection.status === 'active' and token not expired
  2. scopes: all requiredScopes ⊆ connection.granted_scopes
  3. granular: for each requiredAsset, granular_scopes targets the selected asset id
  4. assets: required asset rows exist and selected=true (page/ig/adaccount)
  5. role: user_role on the asset is sufficient (Page admin / AdAccount Advertiser+)
  6. mode: business.agent_mode is in capability.modes
  7. blockers: every blockedBy capability is also ready
  → status: 'ready' | 'needs_permission' | 'needs_asset' | 'needs_role' | 'wrong_mode' | 'blocked' | 'future_only'
```

Output shape matches §3 in the user's original plan but with the seven failure dimensions made explicit so the UI can render the precise remedy ("connect your Instagram account" vs "ask Meta admin to give you Advertiser role").

---

## 4. OAuth flow (Path B)

Routes added under `web/src/app/api/meta/`:

| Route | Purpose |
|---|---|
| `POST /api/meta/oauth/start` | Generates HMAC-signed `state` (10-min TTL, single-use), inserts into `meta_oauth_state`, returns redirect URL to Meta's `/dialog/oauth?...&scope=<tier1>` |
| `GET /api/meta/oauth/callback` | Validates state (signature + DB single-use + TTL), exchanges code → short-lived → long-lived token, calls `/me`, `/me/permissions`, `/me?fields=granular_scopes`, `/me/accounts`, `/me/adaccounts?fields=user_role,name,currency,timezone_name`, populates `meta_connections` + `meta_pages` + `meta_ad_accounts`, resolves IG via Page tokens, encrypts and persists tokens. Redirects to `/integrations?connected=1`. |
| `POST /api/meta/oauth/disconnect` | Marks connection `revoked`, schedules token wipe after 30 days (audit retention), redirects. |
| `POST /api/meta/deauthorize` | **Webhook** Meta calls when user removes the app. Validates `signed_request`. Marks connection `revoked` immediately. Required for App Review. |
| `POST /api/meta/data-deletion` | **Webhook** Meta calls on user data-deletion request. Returns `{url, confirmation_code}` per spec in [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md). |
| `POST /api/meta/sync` | Manual "sync assets" trigger — re-fetches Pages/IG/AdAccounts for a connection. |

### State token format

`state = base64url( HMAC_SHA256(secret, "${appUserId}:${businessId}:${nonce}:${ts}") || ":" || appUserId || ":" || businessId || ":" || nonce || ":" || ts )`

Validated by:
1. HMAC match
2. `ts` within 10 min
3. Row exists in `meta_oauth_state` and `consumed = false`
4. Marked `consumed = true` after successful exchange

### Encryption

- Algorithm: **AES-256-GCM** (Node `crypto.createCipheriv`).
- Key: 32 bytes, from **GCP Secret Manager** secret `meta-encryption-key-v1`. Loaded once at boot, kept in memory.
- Storage format: `base64url( key_version || iv (12B) || ciphertext || tag (16B) )`.
- Key rotation: store `key_version` (uint8) prefix so future re-encryption knows which key to use. New connections always encrypt with the latest version.

Helpers live in `web/src/lib/crypto.ts`. Pure functions, server-only.

---

## 5. App Review submission strategy — tiered

Meta scopes are submitted by **use case** (per the 2024+ App Review changes), not individual scopes. The plan tiers submissions:

| Tier | Use case | Scopes bundled | Demo | Depends on |
|---|---|---|---|---|
| 1 | Read Marketing + Pages + IG | `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, `ads_read`, `business_management` (read-only) | Connect → view ad performance + Page posts + IG insights in dashboard | Business Verification (partial) |
| 2 | Publish to Pages + IG | `pages_manage_posts`, `instagram_content_publish` | Pick gallery asset → propose post → approve in `/approvals` → confirm published in Meta UI | Tier 1 approved |
| 3 | Marketing API write | `ads_management` (+ already-granted `business_management`) | Pick draft → approve → confirm campaign created in Ads Manager | Tier 2 approved + **BV verified status** |
| 4 | WhatsApp | `whatsapp_business_management`, `whatsapp_business_messaging` | future | own track, not now |

Why tiering: a single bundled submission with `ads_management` + `pages_manage_posts` + `instagram_content_publish` quintuples the rejection surface area. Reviewers reject for any unclear demo; one rejection bounces all scopes. Tiered = one rejection ≠ total loss.

### Submission artifacts checklist (per tier)

- [ ] Privacy Policy URL — live on prod domain ([`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md) is the draft)
- [ ] Terms of Service URL — live
- [ ] Deauthorize callback URL — `https://<prod>/api/meta/deauthorize` reachable
- [ ] Data Deletion callback URL — `https://<prod>/api/meta/data-deletion` reachable
- [ ] Test user credentials — Meta test user with admin on a test Page + linked IG + test AdAccount
- [ ] Screencast (per use case) — recorded against prod, not localhost
- [ ] Business Verification — `verified` status before Tier 3

---

## 6. Conflicts with current architecture — resolved

Two real conflicts surfaced during audit:

### 6.1 `web/CLAUDE.md`: "No direct Meta API calls from the web"

The current rule routes Meta access through the Python agent. This plan adds **read-only Meta calls in web routes** for OAuth bootstrap + readiness checks. Reasoning:

- OAuth callback **must** call Graph (token exchange, `/me/permissions`) before the agent ever runs.
- Readiness checks (capability layer) are per-request and per-tenant — running them via cron is wrong latency.
- Write operations (`publishX`, `createOrUpdateCampaign`) still go through the agent, gated by `approvals`. The HITL invariant is preserved.

**Action:** update `web/CLAUDE.md` to: *"No direct Meta **write** calls from the web. Reads for OAuth bootstrap, asset discovery, and readiness checks are allowed via [`src/lib/meta-capabilities.ts`](src/lib/meta-capabilities.ts) and the routes under [`src/app/api/meta/`](src/app/api/meta/)."*

### 6.2 `meta.ts` hardcoded to `process.env.META_ACCESS_TOKEN`

[`web/src/lib/meta.ts:18`](../../web/src/lib/meta.ts#L18) reads env directly. Path A keeps working (Aiweon's row stays system_user_token, env still injected from Secret Manager). For Path B we add `getTokenForBusiness(businessId)` that resolves:

1. If `business.meta_auth_mode === 'system_user_token'` → env var (Path A).
2. If `meta_auth_mode === 'user_token'` → decrypt `meta_connections.long_lived_token_encrypted` for the active connection.
3. If no active connection → throw `MetaConnectionRequired` (UI handles).

All callsites in `meta.ts` switch from `getToken()` to `getTokenForBusiness(businessId)`. Existing signatures gain a `businessId` parameter (additive — Aiweon's single-business default still resolves via `BUSINESS_ID` env).

---

## 7. Three-mode state machine

`businesses.agent_mode ∈ { insight, draft, action }`. Behavioural contract:

| Mode | Reads Meta? | Writes `approvals`? | Calls Meta write endpoints? | Default for |
|---|---|---|---|---|
| `insight` | ✅ | ❌ | ❌ | Day 1 (first 7 days after connection) |
| `draft` | ✅ | ✅ | ❌ | Day 8+ (default per HITL philosophy) |
| `action` | ✅ | ✅ | ✅ (only with approved `approvals` row) | Mature businesses after operator confidence |

Promotion rules (enforced in code, not "operator picks"):

- `insight → draft`: automatic after 7 days OR operator override
- `draft → action`: only manual; requires ≥3 approved proposals in the last 30 days AND operator confirmation modal

UI: a single dropdown in `/settings` under "מצב פעולת הסוכן" with current mode + reason for any restrictions. Switching to a mode the data doesn't justify shows the gate, not the option.

---

## 8. Webhook subscriptions (deferred to phase 2)

In scope of this branch: **deauthorize + data-deletion endpoints only** (App Review requirement). Out of scope: subscribing to `feed`, `mentions`, `comments`, `ads_account` webhooks — those wait for phase 2 ("real-time insight"). Reasoning: webhook subscriptions add a separate App Review item ("Webhooks for X") and complicate verification.

Phase-2 doc: `docs/plans/meta-webhooks-phase2.md` (not yet written).

---

## 9. Implementation phases (this branch)

### Phase 1 — foundation (no UI yet)

1. Plan doc (this file). ✅
2. Decisions log entry §1.12.
3. Migrations 011, 012, 013.
4. `meta-capabilities.ts` — pure, no Graph calls yet.
5. Zod schemas for connection + readiness shapes.
6. Update CLAUDE.md (`web/CLAUDE.md`) about web-side Meta reads.

### Phase 2 — encryption + token plumbing

7. `web/src/lib/crypto.ts` — AES-GCM helpers + Secret Manager loader.
8. `web/src/lib/meta-tokens.ts` — `getTokenForBusiness(businessId)` resolver.
9. Migration tests + capability layer unit tests (Vitest).
10. DB adapter additions: `getConnectionForBusiness`, `upsertConnection`, `recordApiCall`, etc.

### Phase 3 — OAuth routes

11. `/api/meta/oauth/start` + state HMAC helper.
12. `/api/meta/oauth/callback` — token exchange + asset discovery + persist.
13. `/api/meta/deauthorize` + `/api/meta/data-deletion` (signed_request validation).
14. `/api/meta/oauth/disconnect` + `/api/meta/sync`.

### Phase 4 — UI

15. `/integrations` route — connection card per business, "Connect Meta" CTA, asset picker, readiness dashboard.
16. `/settings` — agent_mode dropdown.
17. Connection health badge in nav (reuses `token-expiry.ts`).

### Phase 5 — App Review prep

18. Live deploy of `/api/meta/deauthorize` + `/api/meta/data-deletion` reachable from public web.
19. Privacy/Terms URLs published.
20. Screencast script per use case (Tier 1 first).
21. Submit Tier 1.

---

## 10. What this plan does **not** do

- Does not change Aiweon's current `META_ACCESS_TOKEN` env setup. Path A continues exactly as today.
- Does not introduce a state-management library, queue, or service mesh.
- Does not subscribe to Meta webhooks beyond the two required for App Review.
- Does not add a CRM. The `external_crm_ref` columns are stubs — empty until a downstream CRM is wired.
- Does not request WhatsApp scopes. The capability is declared but stubbed.
- Does not move existing direct Meta calls in [`web/src/lib/meta.ts`](../../web/src/lib/meta.ts) out of the web layer. They become token-resolved instead of env-resolved.

---

## 11. Where truth lives

| Question | Read |
|---|---|
| Why each decision was made | [`decisions-log.md`](decisions-log.md) §1.12 |
| App Review submission content | [`meta-app-review-*.md`](.) |
| Business Verification status | [`task-2.4-bemtech-bv.md`](task-2.4-bemtech-bv.md) |
| Token expiry behaviour today | [`../../web/src/lib/token-expiry.ts`](../../web/src/lib/token-expiry.ts) |
| Tracking pre-flight guardrail | [`../../migrations/008_schema_additions.sql`](../../migrations/008_schema_additions.sql) §2 |
| HITL invariant | [root `CLAUDE.md`](../../CLAUDE.md) "How You Talk" + [`web/CLAUDE.md`](../../web/CLAUDE.md) "What NOT to do" |
