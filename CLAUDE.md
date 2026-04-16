# CLAUDE.md

## Overview

**Campaigner** is a Meta Ads automation agent for **Aiweon** — an AI-based digital marketing agency and SaaS platform in Israel. The agent evaluates, optimizes, creates, and iterates paid ad campaigns on Meta (Facebook/Instagram) with Human-in-the-Loop approvals.

- **Design philosophy:** Claude Code Native + Terminal First (MVP). LangGraph orchestration deferred to v2.
- **HITL:** every agent decision writes a row to Supabase `approvals`; execution happens only after human approval (CLI or web).
- **Scope MVP:** one business (Aiweon), Facebook + Instagram, Hebrew, single Meta ad account.
- **Fork of:** `sandhere01/meta-ads-automation-ai`. This is a **bemtech client project**.

## 🧭 Core Knowledge (READ BEFORE EDITING)

These three documents are canonical — **anything you write in code, prompts, or guardrails must align with them:**

| Doc | Purpose | When to read |
|---|---|---|
| **[docs/plans/campaigner-spec.md](docs/plans/campaigner-spec.md)** | Full technical spec — architecture, data model, cron, tools, tech stack, deferred-to-v2 items | Before touching architecture, schema, or cron |
| **[docs/CAMPAIGN_EVALUATION.md](docs/CAMPAIGN_EVALUATION.md)** | Shared philosophy — "how we decide if a campaign is good enough." Two-gate model (leading/lagging signals), deprecated pre-Andromeda rules, when to ask a human | Before editing `prompts/*.md`, `guardrails.py`, or `tools/check_*.py` |
| **[docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md](docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md)** | Unified 2026 best practices — campaign structure, objectives, budgets, creatives, placements, Pixel/CAPI setup, launch checklist | Before building / generating new campaigns |

**Supporting research:** `docs/deep_research/` — raw outputs from multiple AI research tools (Grok, Manus) + `findings-diff.md` mapping research to spec changes.

## What This Project Does (MVP)

The agent runs stateless via `cron` → `claude -p "..."` headless invocations:

1. **Daily observe-propose** (09:00 IL): Fetches Meta snapshot, evaluates using the two-gate model (CAMPAIGN_EVALUATION.md), writes proposals to Supabase `approvals` table.
2. **Execute approvals** (every 15 min): Reads approved rows, re-checks guardrails, calls Meta Marketing API.
3. **Weekly creative firehose** (Mon 10:00 IL): Generates 3-5 new creatives per active campaign (Andromeda prefers 10-50+ diverse creatives; don't prune manually).

All decisions are logged to Supabase `agent_decisions` — replaces LangSmith/Langfuse for MVP observability.

## Ad Accounts

| Account | ID | Purpose |
|---|---|---|
| Bemtech (professional) | `act_1390480923117690` | Production — real client campaigns |
| Ro'ee Halamish (personal) | `act_202495959` | Testing and development |

## Architecture (MVP — Claude Code Native)

```
cron (Cloud Scheduler)
  → runners/*.sh → claude -p "..."
  → Claude reads CAMPAIGNER.md + prompts/*.md
  → Claude invokes Python CLI tools via Bash
  → Python tools talk to Meta (facebook-business) + Supabase
  → Decisions logged; proposals queued for human approval
```

### Key directories (planned — see spec §19)

| Path | Purpose |
|---|---|
| `campaigner/CAMPAIGNER.md` | Agent protocol Claude loads at every invocation |
| `campaigner/prompts/` | Knowledge files Claude reads (performance-brain, decision-tree, guardrails) |
| `campaigner/tools/` | Python CLI tools Claude calls via Bash (fetch_insights, propose_task, log_decision, etc.) |
| `campaigner/cli/` | User-facing CLI (`campaigner approve <id>`, `list`, `inspect`, `run`) |
| `campaigner/lib/` | Shared library (supabase_client, meta_client, baselines) |
| `runners/` | Bash entrypoints for cron (`daily_observe_propose.sh`, `execute_approvals.sh`, `weekly_creative_firehose.sh`) |
| `migrations/` | Supabase SQL migrations |

### Existing legacy files (kept as reference, wrapped by `campaigner/lib/`)

| File | Role |
|---|---|
| `meta_ads_manager.py` | `MetaAdsManager` wrapping `facebook-business` SDK — will be wrapped by `campaigner/lib/meta_client.py` |
| `image_generator.py` | `ImageGenerator` wrapping Vertex AI Imagen — will be wrapped by `campaigner/lib/creative.py` |
| `automation_main.py`, `run_automation.py`, `create_*.py`, `example_real_estate.py` | Legacy one-off scripts — reference only |
| `test_credentials.py`, `diagnose_page_permissions.py` | Still useful for setup validation |

## Tech Stack (MVP)

- **Python 3.11+** + Bash runners
- **Claude Code CLI** (headless, `claude -p`) — agent orchestrator
- **Claude** (Sonnet 4.6 / Opus 4.6) via Anthropic API — the LLM
- **Supabase** (Postgres + Auth + Storage) — DB + HITL queue
- **Vertex AI Imagen** (`google-genai`) — image generation
- **Meta Marketing API** (`facebook-business`) — Meta integration
- **Cloud Run Jobs + Cloud Scheduler** — cron runtime

**Estimated MVP cost:** ~$25/month/business (Claude ~$23, Imagen ~$1.60).

## Setup & Configuration

### GCP Authentication

Imagen uses GCP credentials (not API keys):

```bash
gcloud auth application-default login
```

The GCP project defaults to `bemtech-478413`.

### Environment Variables (`.env`)

```
# LLM
ANTHROPIC_API_KEY=sk-ant-...        # for Claude Code headless
GCP_PROJECT_ID=bemtech-478413
GCP_LOCATION=us-central1

# Meta
META_APP_ID=...
META_APP_SECRET=...
META_ACCESS_TOKEN=...               # Expires ~60 days, manual rotation
META_AD_ACCOUNT_ID=act_...          # Must include act_ prefix
META_PAGE_ID=...

# Supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
BUSINESS_ID=aiweon-uuid
```

### Install & Validate

```bash
pip install -r requirements.txt
python test_credentials.py          # Meta + GCP sanity check
python diagnose_page_permissions.py # Meta Page permissions
```

## Running

### Legacy (direct scripts — still work)

```bash
python run_automation.py          # Create 2 Aiweon ads (PAUSED)
python create_simple_ad.py        # Single ad, minimal setup
```

### MVP flows (when `campaigner/` is built)

```bash
# Manual trigger (usually cron-driven)
bash runners/daily_observe_propose.sh
bash runners/execute_approvals.sh
bash runners/weekly_creative_firehose.sh

# User CLI (terminal-first)
campaigner list --pending
campaigner approve <id>
campaigner reject <id> --reason "..."
campaigner inspect <run-id>
```

## Imagen Model Tiers

| Tier | Model | Cost/Image | RPM |
|---|---|---|---|
| `fast` (default) | `imagen-3.0-fast-generate-001` | $0.02 | 200 |
| `standard` | `imagen-3.0-generate-002` | $0.04 | 20 |
| `ultra` | `imagen-4.0-ultra-generate-001` | $0.06 | — |

Change tier: `ImageGenerator(model_tier="standard")`

## Safety Notes

- **Real API calls**: Scripts create real objects in Meta Ads Manager and cost money (Imagen generation + Meta spend)
- **PAUSED by default**: Ads won't spend until manually activated
- **HITL is load-bearing**: Agent proposes, human approves. No autonomous execution in MVP.
- **Token expiry**: `META_ACCESS_TOKEN` expires ~60 days, no auto-refresh. Plan System User Token post-Business Verification.
- **Budget units**: Meta API `daily_budget` is in **cents** (e.g., `5000` = $50/day)
- **No cleanup**: No delete scripts — manage via Meta Ads Manager UI
- **Meta App must be in Live Mode** to publish ads to real audiences

## Deprecated Pre-Andromeda Rules (never reintroduce)

See CAMPAIGN_EVALUATION.md §8 for the full list. High-impact examples:

- ❌ Frequency > 3 as auto-kill trigger → use Meta Creative Fatigue flag (CPR ≥ 2× historical)
- ❌ 1 ad set = 1 ad structure → consolidated ad sets with 10+ diverse creatives
- ❌ Horizontal scaling by duplication → vertical (budget) scaling only; duplication resets Learning
- ❌ Narrow interest targeting → broad + Advantage+ Audience
- ❌ Manual pruning of underperforming creatives in first 48h → let Andromeda starve them; only kill if hook rate < 25%

## v2 Migration (LangGraph + Gemini)

Triggered when a **second ad account** is added to the system. Separate doc to be written at `docs/plans/langgraph-v2-migration.md`. MVP tooling (`campaigner/tools/`, `lib/`, Supabase schema) is reused; only the orchestration layer changes.

## Original Upstream

- Fork of: `sandhere01/meta-ads-automation-ai`
- Original was Brazilian real estate focused, in Portuguese
- Rewritten for Aiweon (Israel, Hebrew, Vertex AI Imagen, Claude Code agent)
