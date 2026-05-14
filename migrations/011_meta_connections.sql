-- 011_meta_connections.sql
-- Per decisions-log §1.12 — dual-path Meta integration.
-- Path A (Aiweon's own ops) uses businesses.meta_auth_mode='system_user_token'
-- and the existing meta_access_token_encrypted column. Path B (SaaS tenants via
-- OAuth) uses the tables below. Both paths coexist.
--
-- Shape:
--   businesses ──┐
--                ├─ meta_connections (1 per Meta user)
--                ├─ meta_pages (Facebook Pages discovered for this connection)
--                ├─ meta_ig_accounts (Instagram Business linked to a selected Page)
--                └─ meta_ad_accounts (Ad accounts visible to this Meta user)
--
--   meta_oauth_state (independent — single-use CSRF tokens)
--
-- external_crm_ref jsonb on every table per §1.12 decision #1 (CRM hook only,
-- no full CRM in Campaigner). Stays empty until a downstream CRM is wired.

BEGIN;

-- 1. The OAuth connection — one row per (business, Meta user) pair.
CREATE TABLE IF NOT EXISTS meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  meta_user_id text NOT NULL,
  meta_user_name text,
  long_lived_token_encrypted text NOT NULL,
  token_expires_at timestamptz,
  granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- granular_scopes mirrors Meta's /me?fields=granular_scopes response:
  --   [{ "scope": "pages_show_list", "target_ids": ["123","456"] }, ...]
  -- needed because a user can grant a scope for some assets but not others.
  granular_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'partial', 'expired', 'revoked')),
  last_health_check_at timestamptz,
  connected_by_user_id text,
  external_crm_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, meta_user_id)
);

CREATE INDEX IF NOT EXISTS meta_connections_business_status_idx
  ON meta_connections (business_id, status);
CREATE INDEX IF NOT EXISTS meta_connections_health_check_idx
  ON meta_connections (last_health_check_at NULLS FIRST)
  WHERE status = 'active';

COMMENT ON TABLE meta_connections IS
  'OAuth connection per (business, Meta user). Path B only — Aiweon (Path A) keeps using businesses.meta_access_token_encrypted with meta_auth_mode=system_user_token.';
COMMENT ON COLUMN meta_connections.granular_scopes IS
  'Mirrors GET /me?fields=granular_scopes. Per-asset granularity matters because users can grant a scope for some pages/accounts but decline others (Meta UX since 2022).';
COMMENT ON COLUMN meta_connections.external_crm_ref IS
  'Hook for external CRM (decisions-log §1.12 #1). Shape TBD — left jsonb so a future CRM module can attach without schema migration.';

-- 2. Facebook Pages discovered for a connection.
CREATE TABLE IF NOT EXISTS meta_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text NOT NULL,
  -- Page Access Token. Derived from a long-lived user token, this token is
  -- itself long-lived per Meta's docs. Stored encrypted with the same key as
  -- the user token (key_version prefix supports rotation).
  page_access_token_encrypted text NOT NULL,
  category text,
  -- Page roles per Graph: ["ADMIN","ADVERTISER","MODERATOR",...]
  tasks text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- One page per connection marked active for posting / IG resolution.
  selected boolean NOT NULL DEFAULT false,
  external_crm_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, page_id)
);

CREATE INDEX IF NOT EXISTS meta_pages_selected_idx
  ON meta_pages (connection_id) WHERE selected = true;

COMMENT ON TABLE meta_pages IS
  'Facebook Pages a connection has access to. Selected=true marks the page used for posting + IG account resolution.';

-- 3. Instagram Business accounts — linked through a selected Page.
CREATE TABLE IF NOT EXISTS meta_ig_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  ig_user_id text NOT NULL,
  username text,
  linked_page_id uuid NOT NULL REFERENCES meta_pages(id) ON DELETE CASCADE,
  selected boolean NOT NULL DEFAULT false,
  external_crm_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, ig_user_id)
);

CREATE INDEX IF NOT EXISTS meta_ig_accounts_selected_idx
  ON meta_ig_accounts (connection_id) WHERE selected = true;

COMMENT ON TABLE meta_ig_accounts IS
  'Instagram Business accounts discovered via the linked Facebook Page (FB Login + IG-linked-to-Page path, decisions-log §1.12 #3). The Instagram Login direct path is NOT supported.';

-- 4. Ad accounts visible to the Meta user.
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES meta_connections(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  account_name text,
  currency text,
  timezone_name text,
  -- Meta's user_role: 1=Admin, 2=Advertiser, 3=Analyst (per Marketing API).
  -- Stored as int because Graph returns int.
  user_role int,
  -- Business Manager owner id (distinct from our businesses.id). Useful for
  -- detecting accounts owned by a BM the connecting user only has partial
  -- access to.
  business_id_meta text,
  selected boolean NOT NULL DEFAULT false,
  external_crm_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, ad_account_id)
);

CREATE INDEX IF NOT EXISTS meta_ad_accounts_selected_idx
  ON meta_ad_accounts (connection_id) WHERE selected = true;

COMMENT ON COLUMN meta_ad_accounts.user_role IS
  'Meta user_role on this ad account: 1=Admin, 2=Advertiser, 3=Analyst. Read at OAuth callback via /me/adaccounts?fields=user_role. Required for capability layer asset-level role check.';

-- 5. OAuth state — single-use CSRF tokens with TTL.
CREATE TABLE IF NOT EXISTS meta_oauth_state (
  state text PRIMARY KEY,
  app_user_id text NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_oauth_state_cleanup_idx
  ON meta_oauth_state (expires_at) WHERE consumed = false;

COMMENT ON TABLE meta_oauth_state IS
  'One-time-use OAuth state tokens. state itself is HMAC-signed and includes the same fields; the row exists to enforce single-use semantics + expiry cleanup.';

COMMIT;
