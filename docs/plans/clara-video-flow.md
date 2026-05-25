# Clara Video Flow — Implementation Plan

**Status:** Approved · 2026-05-26
**Replaces:** Imagen-based static creative generation in Flow C (Imagen path is fully removed, not retained)
**Scope:** MVP (single business — Aiweon, Hebrew, 9:16 video only)

---

## 1. TL;DR

- **Mon 10:00 IL** — Flow C writes up to **14 Hebrew atmosphere briefs/week** into `creative_gallery` with `status='pending'`. No third-party calls, no spend.
- **Daily ~11:00 IL** — new Flow I consumes **≤ 2 oldest pending briefs**, picks 2-3 source assets from the gallery (images, or single frames extracted from gallery videos), drives **clarasocial.com** via headless Playwright with `CLARA_EMAIL` / `CLARA_PASSWORD`, downloads the rendered 9:16 video with sound, flips the row to `status='generated'`, and queues a `task_type='upload_creative'` approval.
- **Operator** reviews the finished video in the web UI and approves/rejects.
- **Flow B (every 15 min)** uploads approved video to Meta as before.

Imagen is removed from the codebase: `campaigner/lib/creative.py`, the root `image_generator.py` wrapper, the `google-genai` dependency, and the GCP Imagen env vars all go. Cron pipelines run on a new `agent-clara` Docker image (Playwright + Chromium + ffmpeg) alongside the existing base `agent` image.

---

## 2. Flow diagram

```
Mon 10:00 ────► weekly_creative_firehose.sh (Flow C)
                    │
                    └─► writes ≤14 creative_gallery rows: status='pending',
                        kind='video', hebrew_brief, source_asset_ids[]
                        (no storage_url, no clara_video_url yet)

Daily 11:00 ────► daily_clara_generate.sh (Flow I, NEW)
                    │
                    ├─► pulls ≤2 oldest pending rows (FIFO, business-scoped)
                    ├─► resolves source assets:
                    │     - kind='image' → use as-is
                    │     - kind='video' → ffmpeg-extract one frame
                    ├─► Playwright → Clara: login, upload 2-3 frames + Hebrew prompt
                    ├─► waits for render, downloads MP4
                    ├─► uploads MP4 to Supabase Storage
                    ├─► UPDATE creative_gallery SET status='generated',
                    │       storage_url=<clara_video_url>, duration_seconds=...
                    └─► propose_task(upload_creative, creative_gallery_id=...)

Every 15min ───► execute_approvals.sh (Flow B, existing)
                    │
                    └─► for approved upload_creative rows:
                        - MetaClient.upload_video_creative(storage_url)
                        - sets meta_creative_id, uploaded_to_meta_at
                        - creative_gallery row → status='active'

Daily 03:00 ────► (folded into Flow I or its own tiny cleanup)
                    └─► UPDATE creative_gallery
                        SET status='expired'
                        WHERE status='pending' AND created_at < now() - 7d
```

---

## 3. Schema — migration 034

`migrations/034_clara_pending_creatives.sql`:

```sql
BEGIN;

-- 3.1 Add lifecycle status to creative_gallery.
-- Existing rows are real, live, uploaded assets → backfill to 'active'.
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','generated','active','archived','expired'));

UPDATE creative_gallery
  SET status = CASE
    WHEN deleted_at IS NOT NULL THEN 'archived'
    WHEN meta_creative_id IS NOT NULL THEN 'active'
    ELSE 'generated'  -- generated locally but never uploaded
  END;

-- 3.2 Pending-brief fields. Null on existing rows.
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS hebrew_brief text,
  ADD COLUMN IF NOT EXISTS source_asset_ids uuid[],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 3.3 Widen generated_by to include 'clara'.
ALTER TABLE creative_gallery
  DROP CONSTRAINT IF EXISTS creative_gallery_generated_by_check;
ALTER TABLE creative_gallery
  ADD CONSTRAINT creative_gallery_generated_by_check
  CHECK (generated_by IN ('imagen','gemini','manual_upload','meta_backfill','clara'));

-- 3.4 Indexes for the two main queues.
CREATE INDEX IF NOT EXISTS creative_gallery_pending_fifo_idx
  ON creative_gallery (business_id, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS creative_gallery_status_idx
  ON creative_gallery (business_id, status)
  WHERE deleted_at IS NULL;

-- 3.5 business_knowledge: brand info for Clara prompt injection.
ALTER TABLE business_knowledge
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS default_cta_url text;

COMMENT ON COLUMN business_knowledge.business_name IS
  'Display name auto-injected into Clara prompts. Falls back to businesses.name when null.';
COMMENT ON COLUMN business_knowledge.default_cta_url IS
  'Landing URL bound to ads produced by Flow I unless overridden per campaign.';

COMMIT;
```

**Invariants enforced at the tool layer, not in SQL:**
- `status='pending'` rows MUST have `hebrew_brief` and `source_asset_ids` (length 2 or 3) populated.
- `status='generated'` rows MUST have `storage_url` populated.
- A row never transitions backwards (`generated → pending` is illegal).

---

## 4. File changes

### 4.1 New files

| Path | Purpose |
|---|---|
| `migrations/034_clara_pending_creatives.sql` | Schema migration above. |
| `campaigner/lib/clara_client.py` | Playwright wrapper: `login(email, password)`, `submit_brief(prompt, photos[]) → video_url`, `download(url) → bytes`. Single-SDK ownership over `playwright`. |
| `campaigner/tools/propose_pending_creative.py` | Writes a `status='pending'` row. Args: `--business-id`, `--hebrew-brief`, `--source-asset-ids`. Enforces weekly cap of 14. |
| `campaigner/tools/list_pending_briefs.py` | FIFO query for the daily runner. Args: `--business-id`, `--limit`. |
| `campaigner/tools/generate_clara_video.py` | Daily orchestrator: pulls pending, resolves sources, calls Clara, uploads to storage, flips status, queues `upload_creative` approval. Enforces 2/day cap. |
| `campaigner/tools/extract_video_frame.py` | ffmpeg helper: `--video-url`, `--at-seconds` → returns a JPEG path. Used for `kind='video'` source assets. |
| `campaigner/tools/expire_pending_briefs.py` | One-line cleanup invoked at the start of Flow I (idempotent). |
| `runners/daily_clara_generate.sh` | Cron entrypoint, follows the standard heartbeat-trap pattern in `runners/CLAUDE.md`. |
| `kubefiles/agent_cronjob_daily_clara.yaml` | k8s CronJob, schedule `0 11 * * *`, env: `CLARA_EMAIL`, `CLARA_PASSWORD`. |
| `dockerfiles/agent.clara.Dockerfile` | Extends the base agent image with Playwright + Chromium + ffmpeg. Separate image to keep the base lean (~200 MB Playwright payload only loaded for Flow I). |
| `tests/golden/clara_flow/` | Two golden scenarios: (a) full happy path Monday → Tuesday → Wednesday, (b) Clara login failure → error decision + retry next day. |

### 4.2 Modified files

| Path | Change |
|---|---|
| `runners/weekly_creative_firehose.sh` | Prompt change only (now writes pending briefs, not Imagen creatives). Heartbeat structure unchanged. |
| `campaigner/prompts/creative-guide.md` | §3 rewritten: Flow C produces Hebrew briefs, source-asset selection criteria, weekly cap enforcement. §6 (Image Generation via Imagen) and §7 (Variation Strategy) **removed entirely** — no longer applicable. §9 MVP scope rewritten around Clara. New §12 documenting the brief format (free Hebrew, atmosphere-focused). |
| `campaigner/prompts/guardrails.md` | New rules in §14: `pending_brief_weekly_cap_14` (hard), `clara_daily_cap_2` (hard), `pending_brief_must_have_2_3_sources` (hard), `clara_video_must_be_9_16` (judgment). |
| `campaigner/tools/check_guardrails.py` | Implement the three hard rules above. |
| `campaigner/tools/execute_task.py` | New branch for `task_type='upload_creative'`: download storage_url, upload via `MetaClient.upload_video_creative`, transition gallery row to `status='active'`. |
| `campaigner/lib/meta_client.py` | Confirm `upload_video_creative` exists; if only image upload is wired, add the video path (Meta `ADVIDEO` endpoint). |
| `campaigner/CAMPAIGNER.md` | Add Flow I to the flow table and the "Before every flow — Load context" matrix (Flow I loads: guardrails, creative-guide, hebrew-copy-style). |
| `runners/CLAUDE.md` | Add Flow I row to the catalog table at the top. |
| `CLAUDE.md` (root) | Update the architecture diagram and flow list — Flow I joins A/B/C/D/E/F/G/H. |
| `docs/plans/campaigner-spec.md` | §6 (Cron) gains Flow I; §10.6 (creative_gallery) updated with the new columns; §7 (creative engine) notes the Imagen → Clara replacement for cron-driven generation. |
| `web/src/app/library/page.tsx` (or equivalent) | New gallery sections: **ממתינות** (status=pending), **שנוצרו** (status=generated, awaiting approval), **פעילים** (status=active), **ארכיון** (archived/expired). |
| `web/src/components/approval-card-upload-creative.tsx` | New approval card: 9:16 video preview, brief text, source-photo thumbnails, approve/reject buttons. |
| `web/src/lib/db/types.ts` | `CreativeGallery` type gains `status`, `hebrew_brief`, `source_asset_ids`, `expires_at`. |

### 4.3 Deleted files & dependencies

| Path | Reason |
|---|---|
| `campaigner/lib/creative.py` | Sole consumer of Imagen. No cron path keeps Imagen. |
| `image_generator.py` (repo root) | Imagen wrapper, no remaining importers after `lib/creative.py` is removed. |
| `scripts/validate_credentials.py` — Imagen / Vertex section | Trim to Anthropic + Meta only. Keep the file. |
| `requirements.txt` | Drop `google-genai` and any Vertex-only deps. |
| `.env.example` + secret docs | Drop `GCP_PROJECT_ID`, `GCP_LOCATION` if used only for Imagen. Keep `gcloud auth application-default login` reference only if other Google APIs are still in play (audit during Phase 2). |
| Any `from campaigner.lib.creative import` callers | Grep and remove before Phase 2 closes. |
| Imagen mentions in root `CLAUDE.md`, `CAMPAIGNER.md`, spec §7 | Rewritten to reference Clara only. |
| `tests/.../test_creative*.py` (if any) | Delete or replace with Clara client tests. |

---

## 5. Brief writing — what Flow C's prompt produces

Per the discussion, the brief is free Hebrew atmosphere prose, no structured fields. Example:

> מסעדת שף בראשון לציון עם תפריט ים-תיכוני מודרני — כלים פשוטים ויפים, אור טבעי שנכנס בערב, אנשים שוקעים בשיחה. רוצים שיריח טוב דרך המסך.

Flow C, per campaign:

1. Decide whether the campaign needs new creative this week (Andromeda diversity floor + fatigue signals from `agent_decisions`).
2. Write 1-3 distinct briefs covering different angles (per `creative-guide.md` §2.1 angle palette).
3. For each brief, call `propose_pending_creative.py`:
   - Pre-pick 2-3 source `creative_gallery` IDs by reasoning over candidates (image rows + video rows with usable frames).
   - Tool inserts a row with `status='pending'`, `hebrew_brief`, `source_asset_ids`, `expires_at = now() + 7d`.
4. Stop when the weekly cap of 14 is reached, account-wide.

---

## 6. Cron schedule

| Flow | Schedule (Asia/Jerusalem) | Container image |
|---|---|---|
| A — observe & propose | `0 9 * * *` | `agent` (base) |
| B — execute approvals | `*/15 * * * *` | `agent` (base) |
| C — pending-brief firehose (modified) | `0 10 * * 1` | `agent` (base) |
| D — competitive research | `0 11 * * 1` | `agent` (base) |
| F — weekly self-audit | `0 8 * * 0` | `agent` (base) |
| G — A/B test decisions | `30 9 * * *` | `agent` (base) |
| H — midday health check | `0 13 * * *` | `agent` (base) |
| **I — daily Clara generation (NEW)** | `0 11 * * *` | **`agent-clara` (Playwright)** |

11:00 chosen so that on Mondays Flow I runs *after* Flow C has finished writing briefs.

---

## 7. Build order

| Phase | Work | Gate before next phase |
|---|---|---|
| **0 — Spike** (½ day) | Manually drive Clara as a human. Record Playwright codegen of: login, prompt input, photo upload, render-wait, video download. Confirm 9:16 + audio is the default. Note any captcha/2FA. | Spike doc committed under `docs/research/clara-playwright-spike.md`. If 2FA blocks env-var auth, revisit auth choice. |
| **1 — Schema + brand-field backfill** (½ day) | Apply migration 034 locally. Backfill rule confirmed against current prod gallery. Run the one-off `UPDATE business_knowledge SET business_name='Aiweon', logo_url='...', default_cta_url='...' WHERE business_id=<aiweon-id>;`. Update `web/src/lib/db/types.ts`. | `docker compose run --rm campaigner python scripts/migrate.py` succeeds; existing UI still loads; Aiweon row has all three brand fields populated. |
| **2 — Flow C rewrite + Imagen removal** (1 day) | New tool `propose_pending_creative.py`. Delete `campaigner/lib/creative.py`, `image_generator.py`, all Imagen importers (grep first), `google-genai` from `requirements.txt`. Rewrite `creative-guide.md` (§3 new, §6/§7 removed, §9 rewritten, new §12). Update guardrails. Update root `CLAUDE.md` + `CAMPAIGNER.md` to drop Imagen mentions. New golden scenario. | Running Flow C locally writes pending rows; `grep -r imagen campaigner/ scripts/` returns nothing live; CI green. |
| **3 — Clara client + Flow I** (2-3 days) | `clara_client.py`, `extract_video_frame.py`, `generate_clara_video.py`, `daily_clara_generate.sh`, `agent.clara.Dockerfile`, k8s manifest. | End-to-end local run: Monday brief → Tuesday Clara video → approval row in DB. |
| **4 — Flow B branch** (½ day) | Add `upload_creative` branch in `execute_task.py`. Confirm `MetaClient.upload_video_creative`. | Approving a generated row in the local UI uploads to the test ad account. |
| **5 — Web UI** (1-2 days) | Library sections + approval card. RTL Hebrew. | Operator can see pending/generated/active rows and approve a finished video end-to-end. |
| **6 — Observability** (½ day) | Heartbeat for Flow I, decision-log shape audit, metrics for "pending depth" and "Clara success rate". | First green production run on Aiweon. |
| **7 — Spec/doc update** (½ day) | Update `campaigner-spec.md`, root `CLAUDE.md`, `runners/CLAUDE.md`, `CAMPAIGNER.md`. Add changelog entry. | PR review. |

Total: ~6-8 working days.

---

## 8. Guardrails added

| Rule | Type | Where enforced |
|---|---|---|
| `pending_brief_weekly_cap_14` | hard | `propose_pending_creative.py` rejects if `COUNT(*) WHERE status='pending' AND created_at > now()-7d ≥ 14` |
| `clara_daily_cap_2` | hard | `generate_clara_video.py` rejects if `COUNT(*) WHERE generated_by='clara' AND created_at::date = today ≥ 2` |
| `pending_brief_must_have_2_3_sources` | hard | `propose_pending_creative.py` validates `len(source_asset_ids) in (2,3)` |
| `clara_video_must_be_9_16` | judgment | Logged post-hoc in `agent_decisions` if returned video metadata reports a different aspect |
| `business_knowledge_brand_fields_required` | hard | Flow I refuses to invoke Clara if `business_name` / `default_cta_url` are null on `business_knowledge` |

All five also documented in `prompts/guardrails.md` §14.

---

## 9. Cost model

| Item | Per unit | Monthly (Aiweon, 2/day cap) |
|---|---|---|
| Clara subscription | Account already provisioned for Aiweon | Plan rate (confirm in Phase 0 doc) |
| Claude tokens (Flow C, weekly) | ~$0.10/brief × 14/wk × 4 | ~$5.60 |
| Claude tokens (Flow I, daily photo-pick) | ~$0.05/run × 30 | ~$1.50 |
| Supabase Storage for videos | ~5MB/video × 60/mo | negligible |
| Imagen savings | -$1.60/mo (was the static-image path) | — |

Net delta vs MVP estimate: roughly flat on Claude tokens; Clara subscription is the new cost line. Hard cap of 2/day = ≤ 60 Clara invocations/month, predictable.

---

## 10. Out of scope (v2 / not now)

- Multi-aspect-ratio rendering per brief (we ship 9:16 only)
- Imagen-driven static images for non-video placements (right-column ads)
- Audio mood tuning per brief (Clara default audio only)
- Regeneration loop on rejection — a rejected video is dead, no retry
- Operator-edit-brief before Clara runs — HITL is on the finished video only
- Multi-business support (single-business MVP holds)
- Brand-asset intake UI (we reuse `creative_gallery` rows already in the system)

---

## 11. Risks & unknowns

1. **Clara auth fragility.** Username/password breaks on captcha, 2FA, IP-rate-limiting, or session rotation. Spike output decides whether we stay on env-var auth or move to persisted-session. Hard fail mode: Flow I logs `error` decision, exits 1, heartbeat=error; operator sees the alert and re-auths manually.
2. **Clara output stability.** No SLA. If Clara is down or slow, daily runner times out and that day's slot is forfeited (not rolled forward — keeps the daily cap honest).
3. **Frame extraction quality.** ffmpeg's default frame may be a transition or blank. Mitigation: pick a frame at 25% of duration, not 0s; spike confirms.
4. **business_knowledge backfill.** Migration 034 adds `business_name` / `logo_url` / `default_cta_url` as nullable. The Aiweon row is backfilled in Phase 1 by a one-off `UPDATE` (operator supplies the three values at that point). Guardrail `business_knowledge_brand_fields_required` blocks Flow I for any business missing them, so a forgotten backfill fails closed rather than producing a broken video.
5. **Playwright in Cloud Run.** Some Cloud Run base images need `--no-sandbox` and `--disable-dev-shm-usage` flags. Documented in `agent.clara.Dockerfile`.

---

## 12. Definition of done

- A pending brief written on Monday gets a generated video by Wednesday at the latest, with a `task_type='upload_creative'` row visible in the approvals UI.
- Operator can approve that row and see the video live in the test Meta ad account within 15 minutes (Flow B's cadence).
- Weekly cap and daily cap both verifiable from the DB: `SELECT COUNT(*) FROM creative_gallery WHERE status='pending' AND created_at > now()-7d` ≤ 14; `SELECT COUNT(*) FROM creative_gallery WHERE generated_by='clara' AND created_at::date = today` ≤ 2.
- All four CLAUDE.md surfaces touched (root, runners, campaigner, prompts) reflect Flow I.
- One full golden scenario in `tests/golden/clara_flow/` passes in CI.
