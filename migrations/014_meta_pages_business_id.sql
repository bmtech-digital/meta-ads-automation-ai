-- 014_meta_pages_business_id.sql
-- Add Business Manager id to meta_pages so the UI can filter Pages by the
-- selected Ad Account's BM scope.
--
-- Per integrations UX: the user picks an Ad Account first, then only Pages
-- that live in the same Business Manager appear in the Page dropdown. This
-- mirrors how Meta itself organizes assets (BM → Pages + Ad Accounts).
--
-- Nullable because legacy connections (created before this migration) won't
-- have it populated until their next /api/meta/sync run. The UI degrades
-- gracefully: when business_id_meta is NULL on the Page or the selected Ad
-- Account, the filter shows all Pages (no false negatives).

BEGIN;

ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS business_id_meta text;

COMMENT ON COLUMN meta_pages.business_id_meta IS
  'Business Manager id that owns this Page (from GET /me/accounts?fields=business). NULL when the Page is personal or unknown. Used by /integrations UI to filter Pages by selected Ad Account.';

COMMIT;
