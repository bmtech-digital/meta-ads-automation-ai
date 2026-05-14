-- 015_meta_ig_business_owned.sql
-- Some Instagram accounts are owned at the Business Manager level and have
-- no linked Facebook Page (or the linked Page isn't visible to our user).
-- Our previous discovery (per-Page → linked IG) missed those. This migration
-- supports BM-owned IG discovery:
--
--   1. Add business_id_meta to meta_ig_accounts so we can filter IG by the
--      same BM as the selected Ad Account, even when there's no linked Page.
--   2. Relax linked_page_id to nullable. BM-owned IGs may have no Page.
--   3. Update the unique constraint so duplicate detection still works
--      (connection_id, ig_user_id remains the natural key).

BEGIN;

ALTER TABLE meta_ig_accounts
  ALTER COLUMN linked_page_id DROP NOT NULL;

ALTER TABLE meta_ig_accounts
  ADD COLUMN IF NOT EXISTS business_id_meta text;

COMMENT ON COLUMN meta_ig_accounts.linked_page_id IS
  'FK to meta_pages when the IG was discovered via Page linking. NULL when the IG is BM-owned and not linked to any Page our user has access to.';
COMMENT ON COLUMN meta_ig_accounts.business_id_meta IS
  'BM id that owns this IG (from GET /{bm}/owned_instagram_accounts or inferred from linked_page.business_id_meta). Used by /integrations UI to filter IG by selected Ad Account.';

COMMIT;
