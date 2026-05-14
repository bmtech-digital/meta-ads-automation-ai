# Campaigner — Additive Brain Improvements & Gallery Integration

> **Status:** Draft plan awaiting approval. Mirror of `C:\Users\harel\.claude\plans\cheeky-seeking-blossom.md`. See also [decision-map.md](decision-map.md) (tier 2/3 backlog) and [cheeky-seeking-blossom-progress.md](cheeky-seeking-blossom-progress.md) (session tracker).

## Context

**Why this plan exists.** Roi asked for a research-first audit of the existing Campaigner agent before any building. The concern: the agent might lack explicit judgment for campaign health, timing, creative fatigue, format choice (image/video/mixed), and variation count — and the new gallery/media-intelligence layer might be a dead-end producer that the brain never consumes. After initial planning, Roi pushed back and asked to think broadly — does the plan cover everything a senior performance marketer decides? A second-pass decision-space audit identified three more foundational gaps (M1/M2/M3) that must land in this plan; the rest (M4–M12) go to a separate `decision-map.md`.

**What the audit found.**

- The campaign brain is **stronger than expected**. Two-gate evaluation, 13 hard guardrails, learning-phase caution, decision-tree T0–T6, HITL approval queue, and full `agent_decisions` audit trail are all present and aligned with Meta 2026 principles.
- The gallery is a **well-built asset repository but not an intelligence layer**. No scoring, no classification beyond free-text tags, no similarity/novelty, no per-asset confidence.
- The gallery↔brain integration is **absent in the read direction**. Flow A (observe-propose) never calls `list_gallery_assets` or `list_active_creatives`. Flow C (weekly firehose) is scaffolded but not orchestrated. Approvals reference gallery assets only via implicit JSON, no FK.
- There is **no explicit Creative Decision Policy** that answers "pick from gallery vs generate? image vs video vs mixed? how many variations? how diverse?".
- Approve/reject history is logged but **never reused** as feedback memory.
- **Second-pass findings (decision-space audit):** No tracking-health pre-gate (everything downstream is untrustworthy if Pixel/CAPI is broken). No structured Business Intent / Monthly Brief layer (PERSONALITY.md demands "ask intent before recommending" but nothing enforces it). No Budget Utilization Receipt (PERSONALITY says "check utilization before touching budget" — currently implicit).

**Research-backed alignment (top practitioners).** Charley Tichenor ("Creative is the new targeting" + Liquidity/Natural CAC), Depesh Mandalia (brief-first playbook), Pilothouse 3-3-3 (range×diversity=27 combinations — matches CDP §4 diversity-on-2-of-4-axes), Dara Denney/Barry Hott (symptom-vs-cause layering + do-nothing-first + one-change-at-a-time). M1–M3 implement the foundational layers these practitioners treat as non-negotiable before any optimization.

**What this plan does.** Close the core gaps with **additive, low-risk** changes in two tiers: the gallery/CDP/feedback work (layers A1–A7) + three foundational pre-gates (M1–M3). Do not rewrite. Do not touch existing prompts/tools that already work. Respect Claude Code Native + Terminal First + Docker + HITL discipline.

**Verdict:** Brain = partially sufficient. Weakness = **weak gallery integration + missing creative decision policy + missing feedback loop + missing pre-gates (tracking/intent/utilization)**, not missing campaign judgment within a single campaign.

---

## Scope (what changes and what does NOT change)

**CHANGES (additive):**

1. New prompt file: `creative-decision-policy.md` (picks gallery vs generate, format, variation count, diversity).
2. New Python tools: `score_gallery_assets.py`, `load_feedback_memory.py`, `check_tracking_health.py` (M1), `check_utilization.py` (M3).
3. One additive SQL migration (`011_gallery_scoring_and_feedback.sql`).
4. Inject Step 1.0 pre-gates + Step 1.5 gallery reads into Flow A in `CAMPAIGNER.md`.
5. One-line additions in `guardrails.md` (learning-reset-cost clause) and `creative-guide.md` (§11 pointer to CDP).
6. `propose_task.py`: new optional `--gallery-asset-ids` arg.
7. Dashboard: Monthly Brief editor on `/business-knowledge`; thumbnails on `/approvals/[id]`; score badges on `/gallery`.

**UNCHANGED (protect explicitly):**

- `performance-brain.md`, `decision-tree.md`, `hebrew-copy-style.md`
- `check_data_sufficiency.py`, `check_guardrails.py`, `fetch_insights.py`, `execute_task.py`, `recheck_guardrails.py`, `mark_failed.py`, `heartbeat.py`
- All 13 hard guardrails, anti-flood cap, HITL pending→approved→executed flow, `agent_decisions` schema.
- Existing migrations 001–010.

---

## Architecture — additive layers only

| #      | Layer                               | Purpose                                                                                                                                                                                                               | Location                                                                                      | Hebrew name              |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| A1     | Gallery Reader Step (1.5)           | Flow A + C read gallery + active creatives + feedback memory into context                                                                                                                                             | `CAMPAIGNER.md`                                                                               | קריאת גלריה לפני החלטה   |
| A2     | Creative Decision Policy (CDP)      | Deterministic branch: gallery vs generate, format, count, diversity                                                                                                                                                   | `prompts/creative-decision-policy.md` (new)                                                   | מדיניות החלטות קריאייטיב |
| A3     | Inline Claude Asset Scorer          | Claude writes `{service_fit, novelty_vs_active, diversity_score, expected_angle}` into `creative_gallery.score_snapshot` — no embeddings                                                                              | `tools/score_gallery_assets.py` (new)                                                         | ניקוד נכסים (LLM inline) |
| A4     | Feedback Memory View                | `v_proposal_feedback_30d` + tool — approve/reject rates by task_type, angle, asset_source                                                                                                                             | migration 011 + `tools/load_feedback_memory.py` (new)                                         | זיכרון משוב              |
| A5     | Approvals↔Gallery link              | `approvals.gallery_asset_ids uuid[]` nullable column                                                                                                                                                                  | migration 011 + `propose_task.py`                                                             | קישור הצעה-נכסים         |
| A6     | Format Policy switch                | `business_knowledge.creative.allow_video` flag; CDP §5 uses it                                                                                                                                                        | existing `business_knowledge` row + CDP                                                       | מתג פורמט (תמונה/וידאו)  |
| A7     | UI inline thumbnails + score badges | Read-only display; no write                                                                                                                                                                                           | `web/src/app/approvals/[id]/page.tsx`, `web/src/app/gallery/page.tsx`                         | תצוגת גלריה בהצעה        |
| **M1** | **Tracking Health Gate**            | Pre-diagnosis gate in Flow A. If Pixel/CAPI event rate, match quality, or last-seen is outside tolerance → brain must `alert` operator, NOT diagnose campaigns on untrusted data                                      | `tools/check_tracking_health.py` (new), referenced from `CAMPAIGNER.md` Flow A Step 1.0       | גייט תקינות מדידה        |
| **M2** | **Monthly Brief layer**             | Business intent per month: active offer, primary KPI override, deadlines, hands-off flags. Loaded into Flow A boot context. Enforces PERSONALITY.md "ask intent before recommending"                                  | `businesses.monthly_brief jsonb` (migration 011), `tools/load_business_knowledge.py` (update) | מטרת עבודה חודשית        |
| **M3** | **Budget Utilization Receipt**      | Computes `utilization_ratio = spent / (daily_budget × days_active)` + `pacing_gap`. Proposals that touch budget MUST include this receipt in the rationale. Enforces PERSONALITY.md "check utilization before budget" | `tools/check_utilization.py` (new), rule in `guardrails.md` judgment section                  | קבלה של ניצול תקציב      |

---

## Creative Decision Policy — logic outline (`creative-decision-policy.md`)

Consulted **only** when diagnosis produces `task_type ∈ {new_creative, new_campaign}`.

**Step 1 — Propose at all?**

- T0 solid or give-time → SKIP (`cdp_premature_creative`).
- `learning_phase_active` and proposal would reset learning → SKIP unless emergency override.
- `feedback_memory_30d[task_type].reject_rate > 0.6` → cap 1 proposal, flag `needs_review`.

**Step 2 — Pick from gallery vs generate:**

| Condition                                                                               | Choice                               |
| --------------------------------------------------------------------------------------- | ------------------------------------ |
| `unused_count ≥ required` AND avg `service_fit ≥ 0.7` AND avg `novelty_vs_active ≥ 0.5` | pick_from_gallery                    |
| `unused_count ≥ 1` but novelty low                                                      | mix (best unused + generate rest)    |
| `unused_count = 0` OR all scores low                                                    | generate_new                         |
| `business_knowledge.creative.force_manual_only = true`                                  | pick_from_gallery or SKIP with alert |

**Step 3 — Variation count** (references creative-guide §3, does not duplicate):

| Trigger                          | Count |
| -------------------------------- | ----- |
| T0 winner iteration              | 2–3   |
| T1 CPA high / Meta fatigue flag  | 3–5   |
| Weekly firehose default          | 3–5   |
| Cold start (existing rule)       | 10–12 |
| Feedback memory high reject rate | cap 2 |

**Step 4 — Variation diversity** (material, not cosmetic): each variant must differ from siblings AND active creatives on ≥ 2 of 4 axes:

1. Hook/angle (urgency / benefit / social_proof / comparison / objection)
2. Format (1:1 / 4:5 / 9:16; image vs video once enabled)
3. Visual subject (person / product / scene / text-dominant)
4. CTA or offer framing

**Step 5 — Format policy:**

- `allow_video=false` (default): image-only; at least one 9:16 per batch of ≥ 3.
- `allow_video=true`: mixed bundle — ≥ 1 video per batch of 5, all 3 ratios covered.

**Step 6 — Skip entirely if:** anti-flood cap hit, hard guardrail would trip, gallery `service_fit < 0.3` and generation quota exhausted (→ log `alert`, not proposal).

**Aligned with Meta 2026 findings:** 10–25 genuinely diverse creatives per ad set; 60–70% conversions from static still holds so image-only MVP is defensible; 9:16 vertical priority; Meta Creative Fatigue flag is CPR-based; 7+ days before edits.

---

## Data model — single additive migration

`migrations/011_gallery_scoring_and_feedback.sql`

```sql
BEGIN;

-- A3: Claude-written score snapshot
ALTER TABLE creative_gallery
  ADD COLUMN IF NOT EXISTS score_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS last_scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN creative_gallery.score_snapshot IS
  'LLM-written JSON: {service_fit:0-1, novelty_vs_active:0-1, diversity_score:0-1, expected_angle:text, rationale:text}';

CREATE INDEX IF NOT EXISTS creative_gallery_needs_review_idx
  ON creative_gallery (business_id, needs_review)
  WHERE deleted_at IS NULL AND needs_review = true;

-- A5: approvals <-> gallery link
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS gallery_asset_ids uuid[];

-- A4: 30d feedback memory view
CREATE OR REPLACE VIEW v_proposal_feedback_30d AS
SELECT
  a.business_id,
  a.task_type,
  COALESCE(a.payload->>'angle', 'unknown')        AS angle,
  COALESCE(a.payload->>'asset_source', 'unknown') AS asset_source,
  COUNT(*)                                         AS total,
  COUNT(*) FILTER (WHERE a.status = 'approved')    AS approved,
  COUNT(*) FILTER (WHERE a.status = 'rejected')    AS rejected,
  COUNT(*) FILTER (WHERE a.status = 'executed')    AS executed
FROM approvals a
WHERE a.created_at >= now() - interval '30 days'
GROUP BY 1,2,3,4;

-- M2: Monthly Brief — business intent per month
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS monthly_brief jsonb;

COMMENT ON COLUMN businesses.monthly_brief IS
  'Operator-set monthly intent: {active_offer:text, primary_kpi:text, kpi_override_target:numeric, deadline_date:date, hands_off_campaign_ids:uuid[], notes:text}';

-- M1: Tracking health signal cache
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tracking_health_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS tracking_health_checked_at timestamptz;

COMMENT ON COLUMN businesses.tracking_health_snapshot IS
  'Output of check_tracking_health: {pixel_events_24h:int, capi_events_24h:int, event_match_quality:numeric, last_event_seen_at:timestamptz, verdict: healthy|degraded|broken, rationale:text}';

COMMIT;
```

No pgvector. No embeddings. No new tables. All `ADD COLUMN IF NOT EXISTS` — re-runnable.

---

## Gallery-to-brain integration — the load-bearing fix

**Flow A (daily observe-propose):**

**Step 1.0 — Pre-gates (new, M1+M2+M3):**

```
python -m campaigner.tools.check_tracking_health --business-id $BUSINESS_ID
# If verdict = broken → write `alert` decision, SKIP diagnosis, end run.
# If verdict = degraded → continue, but any proposal MUST cite in rationale.

python -m campaigner.tools.load_business_knowledge --business-id $BUSINESS_ID --include-monthly-brief
# Brief fields (active_offer, primary_kpi, kpi_override_target, deadline, hands_off_ids) injected into prompt context.
```

**Step 1.5 — Read gallery + feedback (existing plan):**

```
python -m campaigner.tools.list_gallery_assets --business-id $BUSINESS_ID --limit 200
python -m campaigner.tools.list_active_creatives --business-id $BUSINESS_ID --since-days 30
python -m campaigner.tools.load_feedback_memory --business-id $BUSINESS_ID --window-days 30
```

**Step 2 — Diagnose + any budget-touching proposal runs:**

```
python -m campaigner.tools.check_utilization --business-id $BUSINESS_ID --campaign-id $CID
# Returns {utilization_ratio, pacing_gap, days_active}. Included in rationale of every budget_change proposal.
```

Brain logs one `observation` decision with `outputs.gallery = {count, unused_count, by_kind, by_service_tag}`. Every subsequent `new_creative`/`new_campaign` proposal must populate `payload.asset_source`, `payload.gallery_asset_ids`, `payload.variation_count`, `payload.diversity_axes`.

**Flow C (weekly firehose):** same Step 1.5 + call `score_gallery_assets.py`. Scoring is Claude-inline (reads asset metadata + active creatives + business_knowledge, emits JSON); tool is a deterministic writer. Cache valid 14 days; if stale, CDP treats novelty as unknown and prefers `generate_new`.

**Prompt injection points:** CDP references the three fields by name; performance-brain gets one new sentence only: "Before final proposal, verify against feedback_memory_30d; if reject_rate for this task_type exceeds 0.6, reduce urgency or request alert instead."

---

## Files to modify

| File                                                                                                           | Change                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [../../migrations/011_gallery_scoring_and_feedback.sql](../../migrations/011_gallery_scoring_and_feedback.sql) | NEW — schema above                                                                                             |
| [../../campaigner/prompts/creative-decision-policy.md](../../campaigner/prompts/creative-decision-policy.md)   | NEW — CDP content                                                                                              |
| [../../campaigner/CAMPAIGNER.md](../../campaigner/CAMPAIGNER.md)                                               | Add Step 1.0 + Step 1.5 to Flow A + C; list CDP in prompt-load sequence                                        |
| [../../campaigner/prompts/creative-guide.md](../../campaigner/prompts/creative-guide.md)                       | Add §11 "Inputs from gallery reader" (pointer only — no duplication)                                           |
| [../../campaigner/prompts/guardrails.md](../../campaigner/prompts/guardrails.md)                               | Add 1 judgment-rule line: learning-reset-cost clause                                                           |
| [../../campaigner/tools/score_gallery_assets.py](../../campaigner/tools/score_gallery_assets.py)               | NEW — deterministic writer for A3                                                                              |
| [../../campaigner/tools/load_feedback_memory.py](../../campaigner/tools/load_feedback_memory.py)               | NEW — reads `v_proposal_feedback_30d`                                                                          |
| [../../campaigner/tools/propose_task.py](../../campaigner/tools/propose_task.py)                               | Add optional `--gallery-asset-ids` CSV arg; backward-compatible                                                |
| [../../campaigner/tools/check_tracking_health.py](../../campaigner/tools/check_tracking_health.py)             | **NEW (M1)** — Pixel/CAPI event rate + match-quality + last-seen; writes `businesses.tracking_health_snapshot` |
| [../../campaigner/tools/check_utilization.py](../../campaigner/tools/check_utilization.py)                     | **NEW (M3)** — utilization_ratio, pacing_gap per campaign                                                      |
| [../../campaigner/tools/load_business_knowledge.py](../../campaigner/tools/load_business_knowledge.py)         | **UPDATE (M2)** — include `monthly_brief` in returned context                                                  |
| [../../web/src/app/approvals/[id]/page.tsx](../../web/src/app/approvals/[id]/page.tsx)                         | Render gallery thumbnails when `gallery_asset_ids` present                                                     |
| [../../web/src/app/gallery/page.tsx](../../web/src/app/gallery/page.tsx)                                       | Read-only score + needs_review badges on tiles                                                                 |
| [../../web/src/app/business-knowledge/page.tsx](../../web/src/app/business-knowledge/page.tsx)                 | **UPDATE (M2)** — add Monthly Brief editor (active_offer, primary_kpi, deadline, hands_off)                    |

**Do not modify:** `performance-brain.md`, `decision-tree.md`, `hebrew-copy-style.md`, `check_data_sufficiency.py`, `check_guardrails.py`, `fetch_insights.py`, `execute_task.py`, `recheck_guardrails.py`, `heartbeat.py`, migrations 001–010.

---

## Safe patch order (phased rollout)

| Phase                          | Scope                                                                                                                                                                                                                                                        | Smallest observable outcome                                                                                                    | Rollback                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **0 — Pre-gates (M1+M2+M3)**   | Apply migration 011 (all ALTER COLUMN blocks). Add `check_tracking_health.py`, `check_utilization.py`. Update `load_business_knowledge.py`. Add Step 1.0 + utilization receipt to `CAMPAIGNER.md` Flow A. Add Monthly Brief editor to `/business-knowledge`. | Flow A logs `tracking_health` and brief context each run; any `budget_change` proposal shows utilization receipt in rationale. | Remove Step 1.0 + utilization-receipt lines from CAMPAIGNER.md; migration additions are nullable and harmless. |
| **1 — Gallery wire only**      | Add Step 1.5 reads to Flow A. CDP advisory only (not authoritative).                                                                                                                                                                                         | Flow A logs new `observation` with gallery summary; `/approvals/[id]` shows thumbnails when present.                           | Remove Step 1.5 paragraph.                                                                                     |
| **2 — Scoring + CDP on**       | Add `score_gallery_assets.py` into Flow C. CDP becomes authoritative for `new_creative`.                                                                                                                                                                     | Firehose proposals cite `asset_source`, `variation_count`, `diversity_axes`.                                                   | Flip CDP to advisory via CAMPAIGNER.md one-line edit.                                                          |
| **3 — Feedback memory**        | Wire `load_feedback_memory.py` into Flow A boot. CDP §1 + §3 start using reject_rate.                                                                                                                                                                        | Fewer proposals in high-reject task_types; new rationale `cdp_feedback_cap`.                                                   | Drop the view-read; CDP falls back to static caps.                                                             |
| **4 — Format/video expansion** | Set `business_knowledge.creative.allow_video=true` per-business; CDP §5 activates mixed bundles.                                                                                                                                                             | First `payload.format=video` proposal appears.                                                                                 | Flip per-business flag back to false.                                                                          |

Each phase ships independently; each reverts with one config line.

---

## Risks & mitigations

| Risk                                                | Mitigation                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learning-phase reset storm from more creative swaps | CDP §1 defers during `learning_phase_active`; new learning-reset-cost clause forces cost disclosure in every rationale; hard guardrails unchanged |
| Anti-flood cap interaction                          | CDP §6 defers to existing cap; CDP can only _reduce_ count, never raise                                                                           |
| Prompt bloat in Flow A                              | Gallery summary = counts + top-20 by novelty; full list only when `new_creative` considered                                                       |
| Hebrew content integrity                            | `hebrew-copy-style.md` untouched; CDP operates on selection/count, not copy                                                                       |
| HITL discipline                                     | No auto-actions added. Every CDP output still `status='pending'`. No bypass path                                                                  |
| Score staleness                                     | `last_scored_at` checked; >14d treated as unknown → prefer generate_new                                                                           |
| Flow A latency                                      | Step 1.0+1.5 = 5 DB/API reads; expected overhead <20% on runner duration                                                                          |
| Schema drift                                        | `ADD COLUMN IF NOT EXISTS` everywhere; migration re-runnable                                                                                      |

---

## Verification — end-to-end tests

Run inside Docker: `docker compose run --rm campaigner <cmd>`.

1. **Migration applies cleanly** against a fresh Supabase snapshot; columns and view exist.
2. **Existing test suite stays green**: `pytest campaigner/tests/`.
3. **Guardrails unchanged**: `check_guardrails.py` against historical fixtures returns identical violation sets (snapshot test).
4. **Data sufficiency unchanged**: `check_data_sufficiency.py` returns identical verdicts byte-for-byte on fixtures.
5. **Replay without CDP** (advisory mode, 30d of recorded `agent_decisions`): no new proposals, no delta in rejection reasons.
6. **Replay with CDP on**: every `new_creative`/`new_campaign` proposal carries `payload.asset_source` + `variation_count`; count never exceeds existing firehose cap.
7. **Heartbeats**: Flow A `duration_ms` increase < 20%.
8. **UI regression**: `/approvals/[id]` with `gallery_asset_ids IS NULL` renders unchanged.
9. **Gallery-full fixture** (50 unused high-`service_fit`) + T0 winner → CDP chooses `pick_from_gallery`, count 2–3.
10. **High-reject fixture** (`reject_rate=0.8` for `new_creative`) → CDP caps at 2 with rationale `cdp_feedback_cap`.
11. **Empty-gallery fixture** → CDP routes to `generate_new`.
12. **Learning-phase fixture** → CDP §1 skips; rationale cites deferral.
13. **Tracking-broken fixture** (M1) → Flow A exits with `alert` decision; no campaign diagnosis occurs.
14. **Monthly Brief absent** (M2) → Flow A runs normally; proposals cite `brief_missing` note.
15. **Budget-change fixture** (M3) → rationale contains `utilization_ratio` + `pacing_gap` fields.

---

## Answers to the product-owner validation checklist

| Question                                              | Current                                          | After this plan                                                |
| ----------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Brain judges good/weak/fatigued/too-early             | **YES** (Gate 1/2 + T0–T6)                       | YES (no change)                                                |
| Brain decides image/video/mixed                       | **NO** (image-only MVP)                          | **PARTIAL** (flag-gated; video via §5 once `allow_video=true`) |
| Brain recommends multiple variants, not just one      | **PARTIAL** (creative-guide §2–3 firehose only)  | **YES** (CDP §3 explicit by trigger)                           |
| Brain safely reuses gallery intelligence              | **NO** (not read)                                | **YES** (Step 1.5 + CDP §2)                                    |
| Brain decides timing correctly                        | **YES** (check_data_sufficiency + T4/T5)         | YES (no change)                                                |
| Brain avoids breaking learning-sensitive campaigns    | **YES** (guardrail §3 `no_learning_phase_touch`) | YES + learning-reset-cost clause adds visibility               |
| Brain improves recommendations without breaking flows | —                                                | **YES** (additive only, phased rollout, each phase reversible) |
| Brain checks tracking health before diagnosing        | **NO**                                           | **YES** (M1 — Step 1.0 gate)                                   |
| Brain respects operator's monthly intent              | **NO**                                           | **YES** (M2 — monthly_brief in boot context)                   |
| Brain cites utilization before touching budget        | **PARTIAL** (implicit)                           | **YES** (M3 — receipt enforced in rationale)                   |

---

## First three files to create post-approval (execution order)

1. [decision-map.md](decision-map.md) — backlog visibility; written FIRST so tier-2/3 mechanisms (M4–M12) are not lost.
2. [cheeky-seeking-blossom-progress.md](cheeky-seeking-blossom-progress.md) — session tracker; initialized empty with phase=0.
3. `migrations/011_gallery_scoring_and_feedback.sql` — applied via `docker compose run --rm campaigner supabase migration up` (or equivalent). Phase 0 begins after this succeeds.
