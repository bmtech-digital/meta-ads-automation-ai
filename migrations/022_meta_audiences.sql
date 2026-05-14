-- 022_meta_audiences.sql
-- Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md §4).
-- Mirror of Meta's audience inventory (Custom / Saved / Lookalike / Special Ad)
-- per business. Synced by `sync_audiences.py` daily and on-demand. Read by
-- `list_audiences.py` and by `expand_audience` / `new_campaign` proposal flows.
--
-- We mirror rather than query Meta live because:
--   (1) audience counts are slow + rate-limited on the Meta side,
--   (2) the agent reads this list every Flow A run — the mirror keeps token use
--       in `claude -p` predictable,
--   (3) the UI needs the list within a page load.
--
-- A separate row exists for each (business_id, meta_audience_id). Audiences
-- that disappear from Meta on the next sync are marked `archived_at`, not
-- deleted — we keep the trail so historical proposals that referenced them
-- still resolve.

BEGIN;

CREATE TABLE IF NOT EXISTS meta_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  meta_audience_id text NOT NULL,                       -- Meta's audience ID
  kind text NOT NULL CHECK (
    kind IN ('custom', 'saved', 'lookalike', 'special_ad')
  ),
  -- For custom audiences: WEBSITE / CUSTOMER_FILE / LEAD_FORM / IG_ENGAGER /
  -- FB_ENGAGER / VIDEO_VIEWERS / APP_ACTIVITY / OFFLINE_CONVERSION_FILE / etc.
  -- For saved/lookalike: NULL.
  subtype text,

  name text NOT NULL,
  description text,

  -- Meta returns three count fields; we keep all three to surface ranges
  -- in the UI (Meta gives upper+lower bounds for privacy on small audiences).
  approximate_count bigint,
  approximate_count_lower_bound bigint,
  approximate_count_upper_bound bigint,

  retention_days integer,

  -- Raw Meta payloads — kept opaque on our side, surfaced for power users.
  data_source jsonb,                                    -- Meta's data_source / subtype payload
  rule jsonb,                                            -- WEBSITE / CUSTOMER_FILE rule definitions
  lookalike_spec jsonb,                                  -- ratio, country, type
  operation_status jsonb,                                -- Meta sync status (ready / syncing / etc.)
  delivery_status jsonb,
  permission_for_actions jsonb,

  -- For Lookalike: the seed audience's Meta ID.
  origin_audience_id text,

  -- For Website audiences: the pixel that feeds the audience.
  external_event_source text,

  -- Meta-side timestamps (when the audience was created/updated on Meta).
  time_created timestamptz,
  time_updated timestamptz,

  -- Full Meta export — last-write-wins on each sync, used for diff-aware UI.
  meta_raw jsonb,

  synced_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a sync no longer sees this audience on Meta. Not deleted so
  -- approvals + decisions can still resolve the reference.
  archived_at timestamptz,

  UNIQUE (business_id, meta_audience_id)
);

CREATE INDEX IF NOT EXISTS meta_audiences_business_kind
  ON meta_audiences(business_id, kind)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS meta_audiences_lookup
  ON meta_audiences(business_id, meta_audience_id);

CREATE INDEX IF NOT EXISTS meta_audiences_synced_at
  ON meta_audiences(business_id, synced_at);

COMMENT ON TABLE meta_audiences IS
  'Mirror of Meta Custom/Saved/Lookalike/Special audiences per business. '
  'Synced by sync_audiences.py. Read by list_audiences.py + expand_audience / '
  'new_campaign proposal flows. archived_at marks audiences no longer visible '
  'on Meta (we keep the row to resolve historical references).';

COMMIT;
