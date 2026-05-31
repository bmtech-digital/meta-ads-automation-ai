# 03 · Account Onboarding — Deep First Scan

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.0, 8.0.1 · **Phase 1 (foundational)**

**Problem:** connecting an existing account today does a piecemeal sync (gallery / audiences / leads separately) — no cohesive first pass, so the agent never *feels* like it understands the account.

**Fix:** when a new business connects an existing Meta ad account, run a one-time orchestrated **deep scan** that builds the strategist's baseline *before* the first conversation. **Pull first, then enrich, then benchmark.**

## The 8 scan steps
| # | Step | Reuses |
|:--:|---|---|
| 1 | **Structural sync** — all campaigns/ad sets/ads + status/budgets + whatever historical insights exist (target 90d; works with 30/60d, confidence scales — see [05 §8.0.2](05-calibration-budget.md)) | `/api/meta/sync` · `fetch_insights.py` |
| 2 | **Asset backfill** — creatives → gallery, audiences, leads | `backfill_gallery_from_meta.py` · `sync_audiences.py` · `sync_leads.py` |
| 3 | **Baselines + health** — rolling baselines, account health, pacing snapshot | `baselines` table · `check_account_health.py` · `compute_monthly_pace.py` |
| 4 | ⭐ **Business-knowledge enrichment** — pull Meta data first, then fill `business_knowledge` (vertical, services, geo, brand voice, KPI targets) from Meta + operator sources (website, brand deck, social, prior campaigns). Quality scales with sources | `business_knowledge` · `load_business_knowledge.py` · `/api/business-knowledge/research-service` |
| 5 | ⭐ **Competitor & market research (automatic)** — same as Flow D, but on first scan: market CPL/CPA benchmarks, audience types, competitor angles & offers for sub-vertical × geo. **Cited only** (guardrail §27) | Flow D · `competitive-research.md` · `estimate_cpl.py` · `kpi-benchmarks.md` · WebSearch |
| 6 | **Creative intelligence pass** (progressive) — structural in P1; full image/video content analysis of whole gallery when [07](07-creative-intelligence.md) lands (P4) | `creative_intelligence` table |
| 7 | **Seed strategic memory** — distil initial observations (what converts, what failed, seasonal patterns, gaps) | `strategic_memory` ([04](04-conversation-engine.md)) |
| 8 | **Opening diagnosis** — first Workspace message: grounded *"here's what I see"* + market positioning vs benchmark CPL + audience map + top 2–3 opportunities (incl. boost candidates). **Not a blank chat box** | Workspace ([09](09-frontend.md)) |

## Principles
- ⭐ **Quality scales with sources (first-class onboarding action):** the more the operator provides — website URL, brand deck, social handles, service list, past campaign exports — the richer the scan, profile, and benchmarks. Onboarding UI actively prompts for these and shows how each improves the scan.
- **Pull-first:** the agent never interrogates cold — it pulls everything from Meta first, drafts the `business_knowledge` profile, and asks only to *confirm/correct/enrich*.
- **Quality-first, not fast-first:** prefer a slower thorough first scan (deeper history, full gallery analysis, live competitor research) — a one-time cost that pays off in every later conversation.
- **Reuses + orchestrates (doesn't duplicate):** `onboarding_status` table + `/onboarding` + the sync/research tools above. New value = orchestration + strategic seeding + opening diagnosis.
- **Runs as a background job** (don't block UI); progress via `heartbeats` / `onboarding_status`.

## 8.0.1 How the scan reaches *quality* (the deep-scan technique)
Borrowed technique from `generic_agent` (crawl-the-whole-site → multi-pass LLM extraction → structured profile + per-business persona, as a slow background job). We output to **structured Postgres** (no Qdrant — mapping a business needs structured extraction, not semantic chunk retrieval).

1. **Multi-source crawl & ingest.** Pull every page of the website + operator sources. **Reuse the team's existing Firecrawl integration**; fallback = sitemap + WebFetch per page.
2. **Multi-pass extraction (not one shallow prompt).** Deliberate Claude passes: services & offers · brand voice & tone · positioning (premium/budget) · ICP / target audiences · proof & trust signals · seasonality. "Slow" = thorough multi-pass → specific, not generic.
3. **Cross-source fusion.** Reconcile website ↔ Meta historical creatives/copy ↔ social ↔ operator input into one coherent `business_knowledge` profile; surface conflicts for confirmation.
4. ⭐ **Persona derivation.** From the brand's actual voice + positioning, derive per-business persona parameters (voice register, formality, premium-vs-value framing, assertiveness) and inject into the [§14 persona](04-conversation-engine.md) — so the strategist *sounds like it belongs to this business*. Stored on `business_knowledge` (or a `persona_profile` jsonb).
5. **Confidence + gaps.** Every extracted fact carries a confidence; low-confidence/missing items become confirm-correct-enrich prompts + an "add these sources to improve me" list.
6. **Background, resumable, observable.** Never blocks UI; per-pass progress via `onboarding_status`/`heartbeats`; **re-runnable** whenever the operator adds a source.

## First-contact flow (T+0 → T+1h)
1. Connect Meta (OAuth) → token stored, `business_id` provisioned.
2. Workspace opens to *"אני חוקר את החשבון שלך... ספר לי על העסק"* while the deep scan runs in background.
3. Operator chats freely; intent engine classifies; [Calibrator](05-calibration-budget.md) starts forming the 2-options view from partial data.
4. Scan finishes (3–15 min) → chat delivers an **opening diagnosis** anchored to real account history.
5. Operator picks an opportunity → Calibrator runs the 2-options output.
6. Operator approves → `propose_task` writes to `approvals` exactly as today.

> **Budget-first onboarding sequence** (the operator's playbook) is specified in [05 §17.4](05-calibration-budget.md): budget capability → market research (CPL + close-rate) → outcome target → 2-options → pick. Lead-need is *derived*, not asked.
