-- 016_multi_business_per_ad_account.sql
-- Multi-business support: one `businesses` row per Meta Ad Account.
--
-- Background: Campaigner started single-business (one Aiweon row). The agency
-- use case requires managing many client ad accounts from one dashboard, so
-- each Meta Ad Account now gets its own `businesses` row with its own
-- approvals/gallery/knowledge/history. A single Meta OAuth connection
-- (one user) provisions multiple businesses on first connect, one per ad
-- account it surfaces.
--
-- Changes:
--   1. `businesses.meta_page_id` becomes nullable. Operators pick the Page for
--      each business after the business is created; before that the column
--      can't have a real value.
--   2. `businesses.meta_access_token_encrypted` becomes nullable. The whole
--      column is legacy from before OAuth — the OAuth-only refactor (this
--      branch) reads tokens from `meta_connections` instead.
--   3. UNIQUE constraint on `businesses.meta_ad_account_id`. Each ad account
--      maps to exactly one business; that's the natural key the connection's
--      ad_accounts → business join relies on.
--
-- No data backfill — the existing single Aiweon row already has a
-- meta_ad_account_id and a meta_page_id, so the new constraints don't reject
-- it. New rows created on OAuth fill these in from the discovered ad account.

BEGIN;

ALTER TABLE businesses
  ALTER COLUMN meta_page_id DROP NOT NULL;
ALTER TABLE businesses
  ALTER COLUMN meta_access_token_encrypted DROP NOT NULL;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_meta_ad_account_id_unique UNIQUE (meta_ad_account_id);

COMMENT ON COLUMN businesses.meta_page_id IS
  'Selected Facebook Page id for this business. Nullable since migration 016 — picked by the operator in /integrations after the business is auto-provisioned from a discovered ad account.';
COMMENT ON COLUMN businesses.meta_access_token_encrypted IS
  'Legacy column (pre-OAuth). Kept for backward compat with the Python agent which still reads from it. Web side reads tokens from meta_connections via the ad-account-to-connection join.';

COMMIT;
