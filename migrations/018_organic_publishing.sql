-- 018_organic_publishing.sql
-- Phase 3 — turn Campaigner into a page-management machine.
--
-- Two changes:
--
-- 1. `approvals` gains the columns needed to schedule publishes and remember
--    what was posted:
--      * scheduled_for     — when the publish should fire (NULL = immediately
--                            on approval). Honored by execute_approvals.sh.
--      * external_post_id  — Meta's id for the published post/story/reel,
--                            written by execute_task on success. Lets us link
--                            back to the live post and pull insights later.
--      * published_at      — wall-clock time the publish API actually fired.
--                            Separate from `executed_at` because FB lets us
--                            ask Meta to schedule natively — in that case
--                            `executed_at` is when we *called* /feed, and
--                            `published_at` is when Meta will publish.
--
--    No CHECK constraint on task_type by design (matches the existing free-form
--    convention used by propose_task.py). New types added in this migration:
--      publish_fb_post, publish_ig_post, publish_ig_story, publish_ig_reel.
--
-- 2. `page_audience_signals` — per-page hour-of-week audience-online scores.
--    Populated by `refresh_page_audience.py` from Meta's
--    /{page_id}/insights/page_fans_online_per_day. The agent reads this to
--    pick scheduled_for at "best time of week" for the network.
--
--    hour_of_week is 0..167 (Sunday 00:00 = 0, Saturday 23:00 = 167; ad
--    account timezone). One row per (page_id, hour_of_week). UPSERTed weekly.

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN approvals.scheduled_for IS
  'When the publish should fire. NULL = execute immediately on approval. execute_approvals.sh selects approvals where scheduled_for IS NULL OR scheduled_for <= now().';

COMMENT ON COLUMN approvals.external_post_id IS
  'Meta-side id of the published artifact (post_id / ig_media_id). Written by execute_task on successful publish.';

COMMENT ON COLUMN approvals.published_at IS
  'When the publish actually went live. For native-scheduled FB posts this may be in the future relative to executed_at.';

-- Re-create the queue index to include scheduled_for so the executor's
-- "ready to fire" query stays cheap.
DROP INDEX IF EXISTS approvals_queue_idx;
CREATE INDEX approvals_queue_idx
  ON approvals (business_id, status, scheduled_for NULLS FIRST, created_at DESC);

CREATE INDEX IF NOT EXISTS approvals_external_post_idx
  ON approvals (external_post_id) WHERE external_post_id IS NOT NULL;

-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS page_audience_signals (
  page_id text NOT NULL,
  hour_of_week smallint NOT NULL CHECK (hour_of_week BETWEEN 0 AND 167),
  online_score integer NOT NULL,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, hour_of_week)
);

COMMENT ON TABLE page_audience_signals IS
  'Per-page hour-of-week audience-online scores from /{page}/insights/page_fans_online_per_day. Used to pick scheduled_for at peak hours.';

COMMENT ON COLUMN page_audience_signals.hour_of_week IS
  '0..167 — Sunday 00:00 = 0, Monday 00:00 = 24, ..., Saturday 23:00 = 167. Asia/Jerusalem timezone.';

ALTER TABLE page_audience_signals ENABLE ROW LEVEL SECURITY;
