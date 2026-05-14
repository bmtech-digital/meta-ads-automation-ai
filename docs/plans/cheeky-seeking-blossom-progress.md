# Progress — Cheeky Seeking Blossom (Additive Brain + Gallery Integration)

> **Purpose.** Single tracker across sessions so the next session can resume cold. Update at the end of every session before closing. One source of truth for "where are we in the implementation."
>
> **Plan:** [cheeky-seeking-blossom.md](cheeky-seeking-blossom.md) • **Backlog map:** [decision-map.md](decision-map.md)

---

## Current state

- **Current phase:** `0 — Pre-gates (M1 + M2 + M3)` — _not started_
- **Plan approved?** _pending Roi approval_
- **Next-session entry point:** apply `migrations/011_gallery_scoring_and_feedback.sql`, then scaffold `campaigner/tools/check_tracking_health.py`.

---

## Phase checklist

### Phase 0 — Pre-gates (M1 + M2 + M3)

- [ ] `migrations/011_gallery_scoring_and_feedback.sql` — write + apply via Docker
- [ ] `campaigner/tools/check_tracking_health.py` — new (M1)
- [ ] `campaigner/tools/check_utilization.py` — new (M3)
- [ ] `campaigner/tools/load_business_knowledge.py` — update to include `monthly_brief` (M2)
- [ ] `campaigner/CAMPAIGNER.md` — add Step 1.0 pre-gates to Flow A
- [ ] `campaigner/prompts/guardrails.md` — add utilization-receipt + learning-reset-cost judgment rules
- [ ] `web/src/app/business-knowledge/page.tsx` — Monthly Brief editor
- [ ] Unit fixtures: tracking-broken, brief-absent, budget-change → validate Flow A behavior
- [ ] Replay last 30d `agent_decisions` — confirm no proposal regressions

### Phase 1 — Gallery wire only

- [ ] `CAMPAIGNER.md` — add Step 1.5 (read gallery + active creatives + feedback memory)
- [ ] `campaigner/tools/load_feedback_memory.py` — new
- [ ] `campaigner/tools/propose_task.py` — optional `--gallery-asset-ids` arg
- [ ] `campaigner/prompts/creative-guide.md` — §11 pointer to CDP (no duplication)
- [ ] `web/src/app/approvals/[id]/page.tsx` — render thumbnails when `gallery_asset_ids` present
- [ ] Smoke: Flow A logs gallery `observation` decision

### Phase 2 — Scoring + CDP authoritative

- [ ] `campaigner/prompts/creative-decision-policy.md` — new (CDP)
- [ ] `campaigner/tools/score_gallery_assets.py` — new
- [ ] `runners/weekly_creative_firehose.sh` — wire scorer into Flow C
- [ ] Fixtures: gallery-full → pick_from_gallery (2-3); empty-gallery → generate_new
- [ ] `web/src/app/gallery/page.tsx` — score + needs_review badges

### Phase 3 — Feedback memory in CDP

- [ ] Wire `load_feedback_memory.py` into Flow A boot context
- [ ] CDP §1 + §3 read `reject_rate`
- [ ] Fixture: high-reject → CDP caps at 2, rationale `cdp_feedback_cap`

### Phase 4 — Format / video expansion

- [ ] `business_knowledge.creative.allow_video` flag → per-business
- [ ] CDP §5 activates mixed bundles when flag=true
- [ ] First video proposal end-to-end test

---

## Session log

| Date       | Session focus                  | Files touched                                                                                                                           | Tests run | Outcome                                                            | Blockers                                               |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| 2026-04-23 | Research audit + plan drafting | `docs/plans/cheeky-seeking-blossom.md` (new), `docs/plans/decision-map.md` (new), `docs/plans/cheeky-seeking-blossom-progress.md` (new) | —         | Plan + decision map + progress tracker written. Awaiting approval. | Plan approval pending; implementation not yet started. |

---

## Open questions

- [ ] Which runner invokes `check_tracking_health.py` first — only Flow A, or also `execute_approvals.sh` before each execution? (Lean: Flow A only for now; Flow B relies on `recheck_guardrails.py`.)
- [ ] Monthly Brief UI — inline on `/business-knowledge` or separate `/brief` page? (Lean: inline.)
- [ ] Should tracking-health `verdict=degraded` block certain proposal types (e.g., budget increases) or only annotate? (Lean: annotate-only; block only `broken`.)

---

## Decisions log (implementation)

_(empty — populate as implementation progresses)_

---

## Links

- Plan: [cheeky-seeking-blossom.md](cheeky-seeking-blossom.md)
- Backlog (tiers 2 & 3): [decision-map.md](decision-map.md)
- Parent spec: [campaigner-spec.md](campaigner-spec.md)
- Personality binding: [../PERSONALITY.md](../PERSONALITY.md)
- Evaluation philosophy: [../CAMPAIGN_EVALUATION.md](../CAMPAIGN_EVALUATION.md)
