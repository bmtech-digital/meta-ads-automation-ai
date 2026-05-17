-- 030_meta_audiences_targeting.sql
-- Permanent import of full saved-audience targeting (2026-05-17).
--
-- Until now, Saved Audiences came back from Meta with a rich `targeting`
-- object (geo, age, gender, interests, behaviors, life events, industries,
-- work, education, family/relationship, exclusions, custom-audience refs,
-- flexible_spec OR-clauses) but we only stored it inside `meta_raw` JSONB —
-- opaque to the UI and to the agent. Roi asked for "permanently import the
-- full audiences" with locations, behaviors, business types, ages, gender,
-- "and everything that exists in saved audiences" surfaced in the system.
--
-- This migration extracts the sub-objects into discoverable columns so:
--   (1) /audiences can render targeting cards without re-parsing meta_raw,
--   (2) the agent can read targeting in Flow A / Flow E without WebSearch
--       or extra Meta calls,
--   (3) `list_audiences.py` can filter by geo/age/gender/interests for
--       overlap detection before proposing new audiences,
--   (4) the Hebrew `targeting_summary` gives operators a one-line "מה זה
--       בכלל?" without expanding a card.
--
-- All columns are NULLable — custom audiences and lookalikes don't carry
-- targeting (their selection logic lives in `rule` / `lookalike_spec`), and
-- some saved audiences are sparse. The sync tool populates whatever's there.
-- Preserved across re-syncs the same way `service_tag` is: sync_audiences.py
-- overwrites these columns with the latest Meta export every run, so any
-- manual edit done in Ads Manager flows back to us automatically.

BEGIN;

-- --- Raw targeting envelope ----------------------------------------------
-- The full Meta `targeting` dict, kept addressable for power-user views
-- and for forward-compat with fields we haven't extracted yet (e.g. new
-- targeting categories Meta may add). Distinct from `meta_raw` which
-- carries everything Meta returned including the wrapping audience fields.
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS targeting jsonb;

-- Hebrew one-line summary built by sync_audiences.py from the parsed
-- fields below. Operator-facing. Example: "תל אביב + 25 ק״מ · גילאי 25-45 ·
-- נשים · 3 תחומי עניין · 2 התנהגויות".
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS targeting_summary text;

-- Meta's own English breakdown lines (`targeting.sentence_lines` or the
-- top-level `sentence_lines` on saved audiences). We keep them verbatim
-- because Meta's phrasing is sometimes more accurate than our parsed view.
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS sentence_lines jsonb;

-- --- Demographics --------------------------------------------------------
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS age_min smallint,
  ADD COLUMN IF NOT EXISTS age_max smallint;

-- Normalized to {'male','female'} array. NULL means "all genders" (Meta
-- represents this as either an empty list or no key at all). We collapse
-- the [1]/[2]/[1,2] enum into readable strings at sync time so the UI
-- doesn't need a lookup table.
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS genders text[];

ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS locales jsonb;

-- --- Geo (inclusions + exclusions) ---------------------------------------
-- Structured envelope:
--   {
--     "countries":         [{"key":"IL","name":"Israel"}],
--     "country_groups":    [...],
--     "regions":           [{"key":"...","name":"מחוז תל אביב"}],
--     "cities":            [{"key":"...","name":"Tel Aviv","radius":10,"distance_unit":"kilometer"}],
--     "zips":              [...],
--     "custom_locations":  [{"name":"...","latitude":...,"longitude":...,"radius":...,"distance_unit":"..."}],
--     "geo_markets":       [...],
--     "electoral_districts":[...],
--     "location_types":    ["home","recent"]
--   }
-- Inclusions and exclusions kept separate so the UI can render "מיועד ל-X,
-- חוץ מ-Y" without parsing the original Meta enum.
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS geo_locations jsonb,
  ADD COLUMN IF NOT EXISTS excluded_geo_locations jsonb;

-- --- Detailed targeting (the "what they're into / who they are" axis) ----
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS interests jsonb,
  ADD COLUMN IF NOT EXISTS behaviors jsonb,
  ADD COLUMN IF NOT EXISTS life_events jsonb,
  ADD COLUMN IF NOT EXISTS industries jsonb,
  ADD COLUMN IF NOT EXISTS work_employers jsonb,
  ADD COLUMN IF NOT EXISTS work_positions jsonb,
  ADD COLUMN IF NOT EXISTS education_schools jsonb,
  ADD COLUMN IF NOT EXISTS education_majors jsonb,
  ADD COLUMN IF NOT EXISTS family_statuses jsonb,
  ADD COLUMN IF NOT EXISTS relationship_statuses jsonb,
  ADD COLUMN IF NOT EXISTS income jsonb,
  ADD COLUMN IF NOT EXISTS net_worth jsonb,
  ADD COLUMN IF NOT EXISTS home_ownership jsonb,
  ADD COLUMN IF NOT EXISTS home_type jsonb,
  ADD COLUMN IF NOT EXISTS home_value jsonb,
  ADD COLUMN IF NOT EXISTS ethnic_affinity jsonb,
  ADD COLUMN IF NOT EXISTS generation jsonb,
  ADD COLUMN IF NOT EXISTS politics jsonb,
  ADD COLUMN IF NOT EXISTS interested_in jsonb;

-- --- Custom-audience refs + flexible OR clauses + exclusions -------------
-- `flexible_spec` is Meta's OR-of-AND wrapper: a list of dicts where each
-- dict is itself a targeting spec. Stored as-is because operator intent is
-- in the structure, not the flat union.
-- `exclusions` is Meta's separate exclusions object (mirrors targeting top
-- level — interests/behaviors/etc. that should be EXCLUDED, not merely
-- "not included").
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS custom_audiences_included jsonb,
  ADD COLUMN IF NOT EXISTS custom_audiences_excluded jsonb,
  ADD COLUMN IF NOT EXISTS flexible_spec jsonb,
  ADD COLUMN IF NOT EXISTS exclusions jsonb;

-- --- Placement axis (saved audiences can pin placements too) -------------
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS publisher_platforms jsonb,
  ADD COLUMN IF NOT EXISTS facebook_positions jsonb,
  ADD COLUMN IF NOT EXISTS instagram_positions jsonb,
  ADD COLUMN IF NOT EXISTS audience_network_positions jsonb,
  ADD COLUMN IF NOT EXISTS messenger_positions jsonb,
  ADD COLUMN IF NOT EXISTS device_platforms jsonb;

-- --- Parse status --------------------------------------------------------
-- TRUE when sync extracted targeting without an exception. FALSE when the
-- raw targeting dict was present but parsing hit something unexpected —
-- meta_raw still has the original, so we can backfill later. NULL means
-- "no targeting on this row" (custom + lookalike audiences).
ALTER TABLE meta_audiences
  ADD COLUMN IF NOT EXISTS targeting_parsed boolean;

-- --- Indexes (only the ones the UI / agent will actually filter by) ------
-- Saved audiences are the only kind that carries targeting; index just
-- those rows to keep the index small.
CREATE INDEX IF NOT EXISTS meta_audiences_age_range
  ON meta_audiences(business_id, age_min, age_max)
  WHERE archived_at IS NULL AND kind = 'saved';

-- GIN on the geo envelope so the agent can query "which saved audiences
-- include city X?" without a full scan once we have a few dozen.
CREATE INDEX IF NOT EXISTS meta_audiences_geo_gin
  ON meta_audiences USING gin (geo_locations)
  WHERE archived_at IS NULL AND geo_locations IS NOT NULL;

CREATE INDEX IF NOT EXISTS meta_audiences_interests_gin
  ON meta_audiences USING gin (interests)
  WHERE archived_at IS NULL AND interests IS NOT NULL;

COMMENT ON COLUMN meta_audiences.targeting IS
  'Full Meta targeting spec for the audience (Saved Audiences only). Kept '
  'addressable for power-user views and for forward-compat with new Meta '
  'targeting categories not yet extracted into typed columns.';

COMMENT ON COLUMN meta_audiences.targeting_summary IS
  'Hebrew one-line summary built by sync_audiences.py from the parsed sub-'
  'fields. Example: "תל אביב + 25 ק״מ · גילאי 25-45 · נשים · 3 תחומי עניין".';

COMMENT ON COLUMN meta_audiences.genders IS
  'Normalized to {male,female}. NULL = all genders (Meta returns no key).';

COMMENT ON COLUMN meta_audiences.geo_locations IS
  'Structured inclusions: countries / country_groups / regions / cities / '
  'zips / custom_locations (lat/lng/radius) / geo_markets / electoral_'
  'districts / location_types. City entries carry optional radius + '
  'distance_unit per Meta. Mirrors `targeting.geo_locations`.';

COMMENT ON COLUMN meta_audiences.excluded_geo_locations IS
  'Same shape as geo_locations but for the EXCLUDED side. Mirrors '
  '`targeting.excluded_geo_locations` (note: separate key from `exclusions`, '
  'which carries non-geo exclusions).';

COMMENT ON COLUMN meta_audiences.flexible_spec IS
  'Meta OR-of-AND wrapper. List of mini targeting dicts joined by OR. We '
  'store as-is because operator intent lives in the structure, not in a '
  'flattened union of all branches.';

COMMENT ON COLUMN meta_audiences.targeting_parsed IS
  'TRUE = sync extracted targeting cleanly. FALSE = targeting was present '
  'but parse hit an unexpected shape (meta_raw retains the original). NULL '
  '= no targeting on this row (custom / lookalike audiences).';

COMMIT;
