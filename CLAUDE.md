# CLAUDE.md

## Overview

**Campaigner** is a Meta Ads automation agent for **Aiweon** — an AI-based digital marketing agency and SaaS platform in Israel. The agent evaluates, optimizes, creates, and iterates paid ad campaigns on Meta (Facebook/Instagram) with Human-in-the-Loop approvals.

- **Design philosophy:** Claude Code Native + Terminal First (MVP). LangGraph orchestration deferred to v2.
- **HITL:** every agent decision writes a row to Supabase `approvals`; execution happens only after human approval (CLI or web).
- **Scope MVP:** one business (Aiweon), Facebook + Instagram, Hebrew, single Meta ad account.
- **Fork of:** `sandhere01/meta-ads-automation-ai`. This is a **bemtech client project**.

## 🧭 Core Knowledge (READ BEFORE EDITING)

These three documents are canonical — **anything you write in code, prompts, or guardrails must align with them:**

| Doc                                                                                        | Purpose                                                                                                                                                         | When to read                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **[docs/plans/campaigner-spec.md](docs/plans/campaigner-spec.md)**                         | Full technical spec — architecture, data model, cron, tools, tech stack, deferred-to-v2 items                                                                   | Before touching architecture, schema, or cron                         |
| **[docs/CAMPAIGN_EVALUATION.md](docs/CAMPAIGN_EVALUATION.md)**                             | Shared philosophy — "how we decide if a campaign is good enough." Two-gate model (leading/lagging signals), deprecated pre-Andromeda rules, when to ask a human | Before editing `prompts/*.md`, `guardrails.py`, or `tools/check_*.py` |
| **[docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md](docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md)** | Unified 2026 best practices — campaign structure, objectives, budgets, creatives, placements, Pixel/CAPI setup, launch checklist                                | Before building / generating new campaigns                            |

**Supporting research:** `docs/deep_research/` — raw outputs from multiple AI research tools (Grok, Manus) + `findings-diff.md` mapping research to spec changes.

## 🆕 New here? Start with these

| You are…                             | Read                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| **A new contributor / employee**     | [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — Day 1 walkthrough   |
| **Looking for the architecture map** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — living overview |
| **About to open a PR**               | [`CONTRIBUTING.md`](CONTRIBUTING.md)                             |
| **An AI agent** (Cursor/Codex/Aider) | [`AGENTS.md`](AGENTS.md) → this file                             |

## 🗺️ Per-folder navigation (CLAUDE.md in every working directory)

When Claude's cwd matches a folder below, that folder's `CLAUDE.md` loads **in addition to** this one. Use it to find the right contract / convention without re-deriving from code.

| Folder                                                | What you'll find there                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`campaigner/`](campaigner/CLAUDE.md)                 | Headless invocation pattern, Hebrew rules, where to look for truth              |
| [`campaigner/tools/`](campaigner/tools/CLAUDE.md)     | CLI-tool catalog, I/O contract, how to add a tool                               |
| [`campaigner/lib/`](campaigner/lib/CLAUDE.md)         | Module map, dependency-direction rule, single-SDK ownership                     |
| [`campaigner/prompts/`](campaigner/prompts/CLAUDE.md) | Knowledge file index, load order, Hebrew vs English audience split              |
| [`campaigner/cli/`](campaigner/cli/CLAUDE.md)         | Operator-CLI subcommand surface, idempotency rule                               |
| [`runners/`](runners/CLAUDE.md)                       | Cron-entrypoint contract, heartbeat trap pattern, exit codes                    |
| [`scripts/`](scripts/CLAUDE.md)                       | Operational scripts catalog (migrate, seed, validate, deploy)                   |
| [`migrations/`](migrations/README.md)                 | Schema layout, migration runner, Supabase port plan                             |
| [`tests/`](tests/CLAUDE.md)                           | Two test layers (golden, contract), how to run, what's intentionally not tested |
| [`tests/golden/`](tests/golden/README.md)             | Golden-scenario format and adding cases                                         |
| [`dockerfiles/`](dockerfiles/CLAUDE.md)               | Three images, when to rebuild which, build-context rule                         |
| [`kubefiles/README.md`](kubefiles/README.md)          | Pointer to the canonical Hetzner k3s manifests (this repo no longer ships its own — production manifests live in the operator's Hetzner infra repo) |
| [`web/`](web/CLAUDE.md)                               | Next.js conventions, dual-mode adapters, Hebrew RTL, run + test                 |
| [`web/src/app/`](web/src/app/CLAUDE.md)               | App Router route map, auth-gate via middleware                                  |
| [`web/src/components/`](web/src/components/CLAUDE.md) | Primitives vs feature components, RTL conventions                               |
| [`web/src/lib/`](web/src/lib/CLAUDE.md)               | Dual-mode DB/auth adapters, Zod schemas, single-SDK ownership                   |
| [`webhook/`](webhook/CLAUDE.md)                       | Lead Ads → Trello receiver, narrow scope (not the agent)                        |

The same docs are also accessible through standard `README.md` files where one already exists ([`web/`](web/README.md), [`migrations/`](migrations/README.md), [`tests/golden/`](tests/golden/README.md)) — those are operator-facing setup guides; the per-folder `CLAUDE.md` files are the agent-facing companions.

When you onboard a new contributor or agent: point them at this navigation map. Each folder is a self-contained unit of context.

## What This Project Does (MVP)

The agent runs stateless via `cron` → `claude -p "..."` headless invocations:

1. **Daily observe-propose** (09:00 IL): Fetches Meta snapshot, evaluates using the two-gate model (CAMPAIGN_EVALUATION.md), writes proposals to Supabase `approvals` table.
2. **Execute approvals** (every 15 min): Reads approved rows, re-checks guardrails, calls Meta Marketing API.
3. **Weekly creative firehose** (Mon 10:00 IL): Generates 3-5 new creatives per active campaign (Andromeda prefers 10-50+ diverse creatives; don't prune manually).
4. **Weekly competitive research** (Mon 11:00 IL): WebSearch on market prices, trending creative angles, and new ad formats in the business's vertical — emits `task_type='alert'` proposals with source-cited findings (guardrail §27 blocks unsourced competitive claims).

All decisions are logged to Supabase `agent_decisions` — replaces LangSmith/Langfuse for MVP observability.

## Ad Accounts

| Account                   | ID                     | Purpose                            |
| ------------------------- | ---------------------- | ---------------------------------- |
| Bemtech (professional)    | `act_1390480923117690` | Production — real client campaigns |
| Ro'ee Halamish (personal) | `act_202495959`        | Testing and development            |

## Architecture (MVP — Claude Code Native)

```
cron (Kubernetes CronJob, Hetzner k3s)
  → runners/*.sh → claude -p "..."
  → Claude reads CAMPAIGNER.md + prompts/*.md
  → Claude invokes Python CLI tools via Bash
  → Python tools talk to Meta (facebook-business) + Postgres
  → Decisions logged; proposals queued for human approval
```

### Key directories (planned — see spec §19)

| Path                       | Purpose                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `campaigner/CAMPAIGNER.md` | Agent protocol Claude loads at every invocation                                                               |
| `campaigner/prompts/`      | Knowledge files Claude reads (performance-brain, decision-tree, guardrails)                                   |
| `campaigner/tools/`        | Python CLI tools Claude calls via Bash (fetch_insights, propose_task, log_decision, etc.)                     |
| `campaigner/cli/`          | User-facing CLI (`campaigner approve <id>`, `list`, `inspect`, `run`)                                         |
| `campaigner/lib/`          | Shared library (supabase_client, meta_client, baselines)                                                      |
| `runners/`                 | Bash entrypoints for cron (`daily_observe_propose.sh`, `execute_approvals.sh`, `weekly_creative_firehose.sh`) |
| `migrations/`              | Supabase SQL migrations                                                                                       |

### Existing legacy files

**Still in active use (imported by `campaigner/lib/`)** — kept at the repo root:

| File                  | Role                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `meta_ads_manager.py` | `MetaAdsManager` wrapping `facebook-business` SDK — wrapped by `campaigner/lib/meta_client.py` |
| `image_generator.py`  | `ImageGenerator` wrapping Vertex AI Imagen — wrapped by `campaigner/lib/creative.py`           |

**Archived** (reference only, not imported by current code) — see [`legacy/README.md`](legacy/README.md):

| Path                                                                                                           | Role                                                            |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `legacy/scripts/automation_main.py`, `run_automation.py`, `create_*.py`, `example_real_estate.py`, `test_*.py` | One-off scripts from the upstream Brazilian real-estate version |
| `legacy/video_analysis*.txt`                                                                                   | Early Vertex video-analysis experiment output                   |

**Setup / validation scripts** — under [`scripts/`](scripts/):

| File                                   | Role                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| `scripts/validate_credentials.py`      | Anthropic + GCP + Meta credential validation (see task 2.3 doc) |
| `scripts/diagnose_page_permissions.py` | Meta Page permissions diagnostic                                |

## Tech Stack (MVP)

- **Python 3.11+** + Bash runners
- **Claude Code CLI** (headless, `claude -p`) — agent orchestrator
- **Claude** (Sonnet 4.6 / Opus 4.6) via Anthropic API — the LLM
- **Supabase** (Postgres + Auth + Storage) — DB + HITL queue
- **Vertex AI Imagen** (`google-genai`) — image generation
- **Meta Marketing API** (`facebook-business`) — Meta integration
- **Hetzner k3s CronJobs** — cron runtime (production); `docker compose` for local

**Estimated MVP cost:** ~$25/month/business (Claude ~$23, Imagen ~$1.60).

## Setup & Configuration

### Vertex AI Imagen credentials (local development only)

Vertex AI Imagen is the one remaining GCP-side dependency — it's a managed API the agent calls, not a deployment target. For local development, the SDK uses Application Default Credentials:

```bash
gcloud auth application-default login
```

In production on Hetzner k3s, the agent CronJobs mount a dedicated GCP service account key via the `gcp-vertexai-credentials` Kubernetes Secret (provisioned by the operator from the Hetzner infra repo). No `gcloud` is needed at runtime — only the JSON key file mounted at `/var/secrets/gcp/credentials.json`.

The GCP project is `bemtech-478413` (kept solely for billing the Vertex AI calls).

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
docker compose run --rm campaigner python scripts/validate_credentials.py        # Anthropic + GCP + Meta
docker compose run --rm campaigner python scripts/diagnose_page_permissions.py   # Meta Page permissions
```

## Running

### Legacy (archived under `legacy/scripts/` — still work, reference only)

```bash
docker compose run --rm campaigner python legacy/scripts/run_automation.py     # Create 2 Aiweon ads (PAUSED)
docker compose run --rm campaigner python legacy/scripts/create_simple_ad.py   # Single ad, minimal setup
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

| Tier             | Model                           | Cost/Image | RPM |
| ---------------- | ------------------------------- | ---------- | --- |
| `fast` (default) | `imagen-3.0-fast-generate-001`  | $0.02      | 200 |
| `standard`       | `imagen-3.0-generate-002`       | $0.04      | 20  |
| `ultra`          | `imagen-4.0-ultra-generate-001` | $0.06      | —   |

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
