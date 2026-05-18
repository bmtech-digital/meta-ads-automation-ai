-- 031_thresholds_schema_version.sql
-- PRD Step 3 — stamp the loaded thresholds schema version on every
-- agent_decisions row.
--
-- Until 2026-05-18 the rule thresholds the agent reasons against were
-- buried as literals inside Hebrew prose in prompts/*.md. Step 3 of the
-- campaigner migration moved them into config/thresholds.yaml with an
-- explicit schema_version. Now every decision row carries the version
-- that was loaded for that run, so:
--   - "Why did this proposal fire on date X?" is answerable by joining
--     the row to the matching threshold snapshot.
--   - A future threshold tweak is auditable end-to-end.
--   - Diagnoses written against schema v1.0.0 don't get re-evaluated
--     under v1.1.0 assumptions.
--
-- log_decision.py reads campaigner.lib.thresholds.SCHEMA_VERSION (a
-- generated constant) at INSERT time and writes it here. The constant
-- is regenerated from config/thresholds.yaml by
-- scripts/generate_from_thresholds.py.
--
-- NULL is allowed for backfill compatibility — rows written before this
-- migration carry NULL. New writes must always carry a value (enforced
-- in the tool, not at the schema level, so a deploy that forgets to
-- regenerate the constants doesn't silently break log_decision).

ALTER TABLE agent_decisions
  ADD COLUMN thresholds_schema_version text;

COMMENT ON COLUMN agent_decisions.thresholds_schema_version IS
  'Snapshot of config/thresholds.yaml `schema_version` loaded for this run. '
  'Stamped by campaigner/tools/log_decision.py from '
  'campaigner.lib.thresholds.SCHEMA_VERSION. NULL only for rows written '
  'before migration 031_thresholds_schema_version (PRD Step 3, 2026-05-18).';
