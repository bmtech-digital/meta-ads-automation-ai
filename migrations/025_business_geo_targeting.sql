-- 025_business_geo_targeting.sql
-- Phase 1 add-on (Campaigner Mastery Plan §4) — per-business geographic
-- targeting.  Mirrors Meta's targeting.geo_locations + excluded_geo_locations
-- shape so draft_new_campaign_payload can drop it in 1:1 without translation.
--
-- Roi 2026-05-13: every campaign needs both an inclusion pool AND explicit
-- exclusions (e.g. "כן ת"א + גוש דן + רדיוס 25km מהמשרד; לא בני ברק").
-- The legacy `service_regions text[]` only carried country/region names and
-- had no exclusion concept — it stays for backwards compat but is no longer
-- the source of truth for new campaigns.
--
-- Shape (jsonb):
-- {
--   "include": {
--     "countries":  ["IL"],                                      // ISO 3166-1
--     "regions":    [{"key":"3873","name":"Tel Aviv District"}], // Meta region keys
--     "cities":     [{"key":"2643743","name":"Tel Aviv"}],       // city without radius — Meta default ~17km
--     "radius_centers": [                                        // explicit lat/lng + radius
--       {"name":"משרד תל אביב","latitude":32.0853,"longitude":34.7818,"radius_km":25}
--     ],
--     "zips":       []                                           // postal codes
--   },
--   "exclude": { same shape, populated independently }
-- }
--
-- All sub-arrays are optional — operator can populate cities OR radius_centers
-- OR both.  An empty object `{}` means "no geo override; fall back to legacy
-- service_regions → countries"; explicit `null` means "no constraint at all".

ALTER TABLE business_knowledge
ADD COLUMN IF NOT EXISTS geo_targeting jsonb;

COMMENT ON COLUMN business_knowledge.geo_targeting IS
  'Per-business geo (include + exclude). Mirrors Meta targeting.geo_locations + excluded_geo_locations. Shape documented in migrations/025_business_geo_targeting.sql. Source of truth for new_campaign and create_saved_audience proposals; legacy service_regions remains as fallback when this is null.';
