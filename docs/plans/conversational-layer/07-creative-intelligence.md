# 07 · Creative & Video Intelligence

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.7, 16 · **Phase 4**

**Problem:** today only **performance** signals exist (hook rate, thumb-stop via `fetch_insights`). There is **no analysis of the creative's actual content.** This adds it — a brain capability the operator explicitly wants.

## What it produces
Tags on `creative_intelligence` (migration `038`) / `creative_gallery`:
`emotional_tone · positioning(luxury|budget) · trust_signals · aesthetic(family|wedding|youth|event) · conversion_suitability · hook_strength · placement_fit` + (video) `pacing · scene_cuts · on-screen_text_density · audio/music_tone · first-3s hook description`.

## Toolchain — build in-stack, don't buy
| Need | Tool | In-stack? | Notes |
|---|---|:--:|---|
| **Image** content analysis | **Claude vision** (Opus/Sonnet) | ✅ | native multimodal; already paid for |
| **Video** content analysis | **Gemini 2.5 Pro/Flash via Vertex AI** | ✅ | native video (audio+visual), FPS sampling, SOTA on VideoMME; reuses existing GCP/Vertex (same project as Imagen) |
| **Hook frame (0–3s)** | ffmpeg keyframe extract → Claude vision | ✅ | precise on the make-or-break opening |
| **Performance overlay** | Meta insights (3s/5s views, thumb-stop, hook rate) | ✅ | already fetched — combine content + performance |
| Virality/retention scoring (optional) | `higgsfield virality_predictor` (MCP) | ⚠️ | external SaaS; complementary, adds vendor/cost — trial in P4, not foundational |
| Cross-platform creative analytics (future) | Segwise / Vidmob / Neurons | ❌ | enterprise, paid — only if scope grows |

## ⭐ Gallery-wide creative learning loop
The brain indexes the **entire gallery — every image, video, post — directly**, not just one asset on demand:
1. **Batch-analyze** all gallery assets → cache content tags on `creative_intelligence` (re-run only on new/changed assets — cost control, see [01 §18](01-architecture.md) risk #6).
2. **Join** content tags ↔ Meta performance (hook rate, thumb-stop, CTR, CPL) ↔ lead-quality outcomes.
3. **Distil winning patterns** into `strategic_memory` (`kind='what_converts'`) — e.g. *"human-focused warm visuals with on-screen text in the first 2s convert best for the weddings service."*
4. So when something works, the agent **knows *why*** and reuses it in future drafts + boost decisions.

**Feeds into:** [Draft Composer](06-drafts-proposals.md) (pick best angle/asset) · creative-refresh advice (*"your visuals are premium but emotionally cold; your best converters are human-focused"*) · **`boost_post` candidate selection** — closes the "never suggests boosting good content" gap ([06 §9](06-drafts-proposals.md)).

## §16 · Build vs buy — verdict: BUILD in-stack for MVP
| | Build in-stack | Buy SaaS |
|---|---|---|
| Cost | reuses existing Claude + GCP; marginal | per-seat / per-analysis subscription |
| Data | stays in our system | leaves to a 3rd party |
| Fit | tailored to our gallery + HITL + Hebrew | generic, cross-platform |
| Effort | moderate (frame sampling + prompts) | low integration, ongoing cost |
| Verdict | ✅ **MVP** | reconsider only if cross-platform analytics becomes core |

## New tool
`analyze_creative.py` — Claude vision for images, Gemini/Vertex for video; writes `creative_intelligence` tags. Exposed to the orchestrator as an Agent SDK tool (Phase 2+ tool list, [01 §10](01-architecture.md)).
