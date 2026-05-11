# Onboarding — your first day on Campaigner

> **Audience:** A new developer / contractor / employee joining the project. Read top-to-bottom; don't skip.
>
> **Time:** ~3 hours from clean machine to first proposal in the local approvals queue.

If you are an AI agent, read [`AGENTS.md`](../AGENTS.md) instead — different audience, different rules.

## What this project is, in one minute

**Campaigner** is a Meta Ads automation agent for **Aiweon** (Israeli AI influencer-marketing platform). The agent:

1. Watches Meta campaigns daily.
2. Decides what to do (scale up, pause, swap creatives, …) using a [two-gate model](CAMPAIGN_EVALUATION.md).
3. Writes proposals to a Postgres `approvals` table.
4. Waits for a human to approve.
5. Executes approved proposals against Meta's Marketing API.

It runs as **stateless cron jobs**, not a daemon. Three flows: daily observe-propose, every-15-min execute, weekly creative firehose. Full picture: [`ARCHITECTURE.md`](ARCHITECTURE.md).

The HITL (Human-In-The-Loop) invariant is load-bearing — **the agent never spends Aiweon's money on its own**. That's the rule that makes this whole thing safe.

## What you'll read before writing any code

In this order. Don't skim — these are short and load-bearing.

| # | Doc | Why |
|---|---|---|
| 1 | [`README.md`](../README.md) | Product framing, quick-start commands |
| 2 | [`ARCHITECTURE.md`](ARCHITECTURE.md) (this folder) | The map: services, data, flows, why-each-choice |
| 3 | [`../CLAUDE.md`](../CLAUDE.md) | Hard rules + per-folder navigation map |
| 4 | [`PERSONALITY.md`](PERSONALITY.md) | The voice and diagnostic method (binding for any prompt change) |
| 5 | [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) | The two-gate model — the "is this campaign good?" question |
| 6 | [`CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](CAMPAIGN_BUILDING_RECOMMENDATIONS.md) | 2026 best practices the agent enforces |

That's ~90 minutes of reading. Don't write code before you've done this once.

## Set up your machine

### Prerequisites

- **Docker Desktop** (Windows / macOS) or Docker Engine (Linux). Compose v2.
- **Git**. We use GitHub.
- **Python 3.11** locally (only for IDE language server — actual execution is in Docker).
- **Node 22** locally if you'll touch the web frontend.
- **gcloud CLI** for GCP auth (Vertex Imagen).
- An IDE that respects [`.editorconfig`](../.editorconfig). VS Code, Cursor, JetBrains all do.

### First-time setup

```bash
# 1. Clone
git clone <repo-url> meta-ads-automation-ai
cd meta-ads-automation-ai

# 2. Get the secrets
# Ask Roi for the .env file. Copy it to the repo root.
#   It contains: ANTHROPIC_API_KEY, META_*, SUPABASE_*, BUSINESS_ID.
# Never commit it. .env is gitignored.

cp .env.example .env       # if you only have the example
# … then fill in real values from the secret share

# 3. GCP auth (Vertex Imagen)
gcloud auth application-default login
# Use the bemtech project: bemtech-478413

# 4. Spin up local stack
make dev                   # postgres + mongo + redis + campaigner shell

# 5. Apply migrations + seed
docker compose run --rm campaigner bash scripts/migrate.sh
docker compose run --rm campaigner bash scripts/seed_local.sh

# 6. Validate everything
docker compose run --rm campaigner python scripts/validate_credentials.py
docker compose run --rm campaigner python scripts/validate_local_env.py
```

If step 6 says everything is green, you're set up. If not — see [Troubleshooting](#troubleshooting) below.

### Pre-commit hooks (recommended)

```bash
pip install pre-commit
pre-commit install
```

Runs ruff/prettier/secret-scan automatically before every commit. Without this, CI will catch issues but you'll iterate slower.

## Your first hour with the codebase

### Tour

```bash
# Look at the agent's protocol
cat campaigner/CAMPAIGNER.md

# Look at one of the prompts
cat campaigner/prompts/decision-tree.md

# Look at one of the tools
cat campaigner/tools/fetch_insights.py
```

That's the loop: a runner shells into Claude → Claude reads `CAMPAIGNER.md` and the prompts → Claude calls Python tools.

### Read the navigation map

Open [`../CLAUDE.md`](../CLAUDE.md) and look at the "Per-folder navigation" table. **Every working folder has its own `CLAUDE.md`** — that's the agent-facing context for that folder. When you cd into a folder, you can `cat CLAUDE.md` to see what rules apply there.

### Run the test suite

```bash
docker compose run --rm campaigner bash scripts/test.sh
```

If green: you have a working baseline. If red: tell Roi before changing anything.

### Trigger a flow manually (against the local DB)

```bash
docker compose run --rm campaigner bash runners/daily_observe_propose.sh
```

Watch the output. The agent will log decisions and queue proposals to your local `approvals` table. Inspect:

```bash
docker compose exec campaigner campaigner list --pending
docker compose exec campaigner campaigner inspect <run-id>
```

You just saw the agent run. That's the whole MVP.

### Run the web dashboard

```bash
docker compose --profile web up web
# open http://localhost:3100
```

Hebrew RTL dashboard. Login with the dev cookie (any email). Browse approvals, view decision history.

## How to make a change

### Where does X live?

Every folder has a `CLAUDE.md` that answers this for its own scope. Use the [navigation map](../CLAUDE.md#-per-folder-navigation-claudemd-in-every-working-directory).

Common cases:

| Change | Where |
|---|---|
| Add a new agent CLI tool | [`campaigner/tools/`](../campaigner/tools/) — read [`tools/CLAUDE.md`](../campaigner/tools/CLAUDE.md) "Adding a new tool" |
| Adjust how the agent diagnoses a campaign | [`campaigner/prompts/decision-tree.md`](../campaigner/prompts/decision-tree.md) — must align with [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) |
| Add a new guardrail | [`campaigner/prompts/guardrails.md`](../campaigner/prompts/guardrails.md) **and** [`campaigner/tools/check_guardrails.py`](../campaigner/tools/check_guardrails.py) if it's deterministic |
| Add a new schema table or column | New numbered file in [`migrations/`](../migrations/) — never edit an applied migration |
| Add a new web route | [`web/src/app/`](../web/src/app/) — read [`web/src/app/CLAUDE.md`](../web/src/app/CLAUDE.md) |
| Add a new UI component | [`web/src/components/`](../web/src/components/) — see [`web/src/components/CLAUDE.md`](../web/src/components/CLAUDE.md) |
| Tweak a cron schedule | [`kubefiles/agent_cronjob_*.yaml`](../kubefiles/) — and update the schedule note in [`runners/CLAUDE.md`](../runners/CLAUDE.md) |
| Update Hebrew copy style | [`campaigner/prompts/hebrew-copy-style.md`](../campaigner/prompts/hebrew-copy-style.md) |

### The non-negotiable rules

From [`CLAUDE.md`](../CLAUDE.md). Memorize these — they show up in code review.

1. **HITL is load-bearing.** Propose → approve → execute. Flow A and Flow C never touch Meta.
2. **Tools, not ad-hoc.** Postgres / Meta / Vertex go through `campaigner/tools/` or `campaigner/lib/`. No `psql`, `curl`, or one-off scripts.
3. **Hebrew rationale, English summary.** Operator rationale in plain Hebrew. Cron one-line summary in English.
4. **Never edit applied migrations.** New numbered file or it doesn't ship.
5. **Dual-mode adapter (web).** No direct `pg` / `@supabase/ssr` outside `web/src/lib/db/` and `web/src/lib/auth/`.
6. **Deprecated pre-Andromeda rules never come back** — see [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) §8.
7. **No secrets in git.** Pre-commit's `detect-secrets` is your last line of defense.

## Workflow for a typical task

1. **Open an issue** (or pick an existing one). Describe the goal in one paragraph.
2. **Branch from `main`**: `git checkout -b feature/<short-name>` or `fix/<short-name>`.
3. **Make changes**. Keep commits small. Use conventional prefixes:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `chore:` tooling, deps, CI
   - `refactor:` non-behavioral change
   - `test:` tests
   - `prompts:` agent prompt or knowledge changes
4. **Run pre-commit**: `pre-commit run --all-files`.
5. **Run tests**: `docker compose run --rm campaigner bash scripts/test.sh`.
6. **Push and open a PR** against `main`. Fill in: what changed, test plan, invariants checked.
7. **CI must be green** before merge. See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

Full PR checklist: [`CONTRIBUTING.md`](../CONTRIBUTING.md#pull-requests).

## Common tasks — cheat sheet

```bash
# Spin up local stack
make dev

# Run all 3 flows manually
bash runners/daily_observe_propose.sh
bash runners/execute_approvals.sh
bash runners/weekly_creative_firehose.sh

# Operator CLI
docker compose exec campaigner campaigner list --pending
docker compose exec campaigner campaigner approve <id>
docker compose exec campaigner campaigner reject <id> --reason "..."
docker compose exec campaigner campaigner inspect <run-id>

# Apply a new migration
docker compose run --rm campaigner bash scripts/migrate.sh

# Reset local DB
docker compose stop postgres && docker compose rm -f postgres
docker volume rm meta-ads-automation-ai_pgdata
bash scripts/migrate.sh
bash scripts/seed_local.sh

# Format + lint
docker compose run --rm campaigner ruff format .
docker compose run --rm campaigner ruff check . --fix

# Web
cd web && pnpm install && pnpm dev
pnpm test       # vitest
pnpm test:e2e   # playwright

# Deploy (only if you're authorized)
make agent      # build + push + apply CronJobs
make web
make webhook
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ConfigError: METa_ACCESS_TOKEN expired` | Meta token rotates ~every 60 days | Generate new long-lived token, update `.env` |
| `permission denied` on `gcloud` calls | ADC auth expired | `gcloud auth application-default login` |
| `dubious ownership` from git inside container | Windows host UID mismatch | `docker compose exec campaigner git config --global --add safe.directory /app` |
| Web at `localhost:3100` shows DB error | Postgres container not healthy | `docker compose ps`; restart with `make dev` |
| Pre-commit fails on `detect-secrets` first run | No baseline yet | `docker compose run --rm campaigner detect-secrets scan > .secrets.baseline` |
| `ruff check` reports issues you didn't write | You're on a stale branch | `git pull origin main` and re-apply your changes |
| Tests pass locally but fail in CI | Different Postgres state | CI uses fresh DB; check your test isolation |

If you're stuck for >30 minutes: ask Roi. Don't disappear into the docs alone.

## Who to ask what

| Question type | Who |
|---|---|
| Product / business intent | Roi |
| Architecture / spec | First read [`ARCHITECTURE.md`](ARCHITECTURE.md), then [`plans/campaigner-spec.md`](plans/campaigner-spec.md), then ask Roi |
| Why a particular guardrail / decision rule | [`CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) and [`PERSONALITY.md`](PERSONALITY.md) |
| Past decisions and their reasoning | [`plans/decisions-log.md`](plans/decisions-log.md) |
| What's currently being built | [`plans/cheeky-seeking-blossom.md`](plans/cheeky-seeking-blossom.md) |
| Anything Hebrew copy related | [`campaigner/prompts/hebrew-copy-style.md`](../campaigner/prompts/hebrew-copy-style.md) |

## Your first PR

Pick something small to ship in your first week. Suggestions:

- Improve a tool's error message (find one with vague output, make it specific).
- Add a unit-style test under [`tests/tools/`](../tests/tools/) for a tool that doesn't have one.
- Add a missing guardrail rationale in Hebrew.
- Fix a typo in any `CLAUDE.md`.

Whatever you pick, follow the [workflow above](#workflow-for-a-typical-task). The point is to learn the loop: branch → change → test → PR → review → merge.

After your first PR is merged, update this file with anything that surprised you. The doc should improve every time someone new reads it.
