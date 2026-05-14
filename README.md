# Campaigner

A Meta Ads automation agent for **[Aiweon](https://weon.co.il)** — an Israeli AI-powered influencer-marketing platform. Built as a **bemtech client project**.

Campaigner evaluates, optimizes, creates, and iterates paid Meta (Facebook + Instagram) ad campaigns with **Human-in-the-Loop approvals**. The agent never spends money on its own — every action goes through a human approval queue.

> **Status:** MVP. One business (Aiweon), Hebrew, single Meta ad account. v2 (multi-tenant, LangGraph, Gemini) deferred until a second account is added.

## What it does

Three flows, scheduled via cron:

1. **Daily observe-propose** (09:00 IL) — pulls Meta insights, evaluates each campaign with a [two-gate model](docs/CAMPAIGN_EVALUATION.md), and queues proposals to the `approvals` table.
2. **Execute approved** (every 15 min) — re-checks guardrails on approved rows, then calls Meta's Marketing API.
3. **Weekly creative firehose** (Mon 10:00 IL) — generates 3-5 new creatives per active campaign (Andromeda's preference is 10-50+ diverse creatives).

A **human reviewer** (terminal CLI or web dashboard) approves or rejects every proposal before it touches Meta.

## Architecture in one screen

```
                          Cloud Scheduler (cron)
                                  │
                                  ▼
                       runners/*.sh  ─►  claude -p (headless)
                                              │
                                              ▼
                              campaigner/CAMPAIGNER.md + prompts/
                                              │
                                              ▼
                                  campaigner/tools/*.py
                              (fetch_insights, propose_task,
                               check_guardrails, log_decision, …)
                                              │
                  ┌───────────────────────────┼─────────────────────────┐
                  ▼                           ▼                         ▼
            Postgres                       Meta                    Vertex AI
        (Supabase target)        (facebook-business SDK)              Imagen
        approvals · agent_decisions
        baselines · creative_gallery
                  ▲
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  campaigner CLI       web/ (Next.js)
  (terminal)           Hebrew RTL dashboard
```

For the full picture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → [`docs/plans/campaigner-spec.md`](docs/plans/campaigner-spec.md).

## Get started

| You are…                                            | Read                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| **A new contributor / employee**                    | [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — Day 1 walkthrough   |
| **Setting up to contribute a PR**                   | [`CONTRIBUTING.md`](CONTRIBUTING.md)                             |
| **An AI agent** (Claude Code, Cursor, Codex, Aider) | [`AGENTS.md`](AGENTS.md) → [`CLAUDE.md`](CLAUDE.md)              |
| **Looking for the architecture overview**           | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                   |
| **Looking for the full technical spec**             | [`docs/plans/campaigner-spec.md`](docs/plans/campaigner-spec.md) |

## Quick start (developer)

```bash
# 1. Clone + cd
git clone <this-repo> && cd meta-ads-automation-ai

# 2. Configure
cp .env.example .env                            # fill in real values
gcloud auth application-default login           # one-time GCP auth

# 3. Boot the local stack (Postgres + Mongo + Redis + campaigner shell)
make dev

# 4. Apply migrations + seed
docker compose run --rm campaigner bash scripts/migrate.sh
docker compose run --rm campaigner bash scripts/seed_local.sh

# 5. Validate credentials
docker compose run --rm campaigner python scripts/validate_credentials.py

# 6. (Optional) Web dashboard at http://localhost:3100
docker compose --profile web up web
```

Full setup walkthrough: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

## Tech stack

| Layer                   | Technology                                                  |
| ----------------------- | ----------------------------------------------------------- |
| Agent runtime           | Python 3.11 + Claude Code CLI (headless `claude -p`)        |
| LLM                     | Claude (Sonnet 4.6 / Opus 4.6) via Anthropic API            |
| Image generation        | Vertex AI Imagen (`google-genai`)                           |
| Meta integration        | `facebook-business` SDK                                     |
| Data + HITL queue       | Postgres (Supabase target)                                  |
| Web dashboard           | Next.js 15 + Tailwind + shadcn/ui (RTL Hebrew)              |
| Webhook receiver        | Flask (Lead Ads → Trello)                                   |
| Container orchestration | Docker Compose (local), GKE CronJobs (production)           |
| CI/CD                   | GitHub Actions ([`.github/workflows/`](.github/workflows/)) |

**MVP cost:** ~$25/month per business (Claude ~$23, Imagen ~$1.60).

## Project structure

```
meta-ads-automation-ai/
├── campaigner/             ← The agent (tools, lib, prompts, CLI)
│   ├── CAMPAIGNER.md       ← Agent operational protocol
│   ├── tools/              ← Python CLI tools the agent calls
│   ├── lib/                ← Shared library (Postgres, Meta, Vertex clients)
│   ├── prompts/            ← Knowledge files the agent reads
│   └── cli/                ← Operator-facing CLI
├── runners/                ← Cron entrypoints (3 flows)
├── scripts/                ← Operational scripts (migrate, seed, validate, deploy)
├── migrations/             ← SQL schema migrations
├── tests/                  ← Pytest (golden + tool contract tests)
├── web/                    ← Next.js dashboard
├── webhook/                ← Flask Lead Ads → Trello receiver
├── dockerfiles/            ← Per-service Docker definitions
├── kubefiles/              ← Kubernetes manifests for GKE
├── docs/                   ← Architecture, personality, evaluation, plans
└── legacy/                 ← Archived upstream-fork scripts (reference only)
```

Every working folder has its own `CLAUDE.md` (agent-facing) — see the [navigation map](CLAUDE.md#-per-folder-navigation-claudemd-in-every-working-directory) in `CLAUDE.md`.

## Status & roadmap

The full status is tracked in [`docs/plans/decisions-log.md`](docs/plans/decisions-log.md). Active build plan: [`docs/plans/cheeky-seeking-blossom.md`](docs/plans/cheeky-seeking-blossom.md) (+ progress: [`docs/plans/cheeky-seeking-blossom-progress.md`](docs/plans/cheeky-seeking-blossom-progress.md)).

## License

[MIT](LICENSE) — see file for full text.

## Origin

Forked from [`sandhere01/meta-ads-automation-ai`](https://github.com/sandhere01/meta-ads-automation-ai) (Brazilian real-estate, Portuguese, DALL-E). Rewritten end-to-end for Aiweon (Israel, Hebrew, Vertex Imagen, Claude Code agent). The original upstream's setup docs are preserved under [`docs/legacy/upstream-pt/`](docs/legacy/upstream-pt/) for reference.
