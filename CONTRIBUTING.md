# Contributing to Campaigner

Campaigner is a Meta Ads automation agent for [Aiweon](https://weon.co.il), built as a **bemtech client project**. This guide covers how to contribute — from setting up your dev environment to opening a PR.

If you are an AI agent (Claude Code, Codex, Cursor, Aider): read [`AGENTS.md`](AGENTS.md) first. The hard rules are non-negotiable.

## Before you write code

Read these in order, **once**:

1. [`README.md`](README.md) — high-level overview.
2. [`CLAUDE.md`](CLAUDE.md) — project context, architecture, ad accounts, tech stack.
3. [`docs/PERSONALITY.md`](docs/PERSONALITY.md) — how the agent talks (binding for any prompt/guardrail change).
4. [`docs/CAMPAIGN_EVALUATION.md`](docs/CAMPAIGN_EVALUATION.md) + [`docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md) — the campaign philosophy that drives every decision rule.
5. The `CLAUDE.md` in the folder you're about to touch — see the [navigation map](CLAUDE.md#-per-folder-navigation-claudemd-in-every-working-directory).

## Set up your environment

The canonical execution path is **Docker**. Host Python is for IDE language-server features; commands run inside the `campaigner` container.

```bash
# 1. Clone + cd
git clone https://github.com/<org>/meta-ads-automation-ai && cd meta-ads-automation-ai

# 2. Set up env
cp .env.example .env                            # fill in real values
gcloud auth application-default login           # one-time GCP auth for Vertex

# 3. Spin up the local stack
make dev                                        # postgres, mongo, redis, campaigner
docker compose run --rm campaigner bash scripts/migrate.sh
docker compose run --rm campaigner bash scripts/seed_local.sh

# 4. Sanity check
docker compose run --rm campaigner python scripts/validate_credentials.py

# 5. (Optional) install pre-commit hooks
pip install pre-commit && pre-commit install
```

For the web dashboard:

```bash
docker compose --profile web up web             # http://localhost:3100
```

See [`web/README.md`](web/README.md) for frontend-specific setup.

## Code style

| Language        | Formatter / linter                                | Config                                                                               |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Python          | `ruff` (replaces black + isort + flake8)          | [`pyproject.toml`](pyproject.toml)                                                   |
| TypeScript      | `tsc --noEmit` + `next lint`                      | [`web/tsconfig.json`](web/tsconfig.json), [`web/.eslintrc.json`](web/.eslintrc.json) |
| Editor defaults | `.editorconfig`                                   | [`.editorconfig`](.editorconfig)                                                     |
| Hooks           | pre-commit (ruff, prettier, secret scan, hygiene) | [`.pre-commit-config.yaml`](.pre-commit-config.yaml)                                 |

Run locally:

```bash
# Python
docker compose run --rm campaigner ruff check .
docker compose run --rm campaigner ruff format .
docker compose run --rm campaigner pytest

# Web
cd web
pnpm exec tsc --noEmit
pnpm exec next lint
pnpm test
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on every PR. Don't merge red.

## The non-negotiable rules

Extracted from [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md):

1. **HITL is load-bearing.** The agent proposes; a human approves; only Flow B writes to Meta. Never bypass `approvals`.
2. **Tools, not ad-hoc.** Postgres / Meta / Vertex access goes through [`campaigner/tools/`](campaigner/tools/) (agent-side) or [`campaigner/lib/`](campaigner/lib/) (library). No `psql`, `curl`, or one-off scripts.
3. **Hebrew rationale, English summary.** Operator-facing rationale in plain Hebrew (no English acronyms in paragraph 1). Cron one-line summary in English.
4. **Never edit applied migrations.** Schema changes go in new numbered files in [`migrations/`](migrations/).
5. **Dual-mode adapter rule (web).** Don't import `pg` or `@supabase/ssr` outside [`web/src/lib/db/`](web/src/lib/db/) and [`web/src/lib/auth/`](web/src/lib/auth/).
6. **Deprecated pre-Andromeda rules never come back** — see [`docs/CAMPAIGN_EVALUATION.md`](docs/CAMPAIGN_EVALUATION.md) §8.
7. **No secrets in git.** `.env` is gitignored; `.env.example` is the template. Pre-commit's `detect-secrets` and `detect-private-key` are your last line of defense.

## Branching + commits

Conventional commit prefixes (used in CI parsing and changelogs):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` non-behavioral code change
- `test:` tests
- `chore:` tooling, deps, CI
- `prompts:` agent prompt or knowledge changes

Branch names: `feature/<short-description>`, `fix/<short-description>`. Merge into `main` via PR.

## Pull requests

Before opening:

- ✅ CI green (`ci.yml`).
- ✅ If touching prompts: tested against [`tests/golden/`](tests/golden/).
- ✅ If touching the schema: added a new numbered migration; old ones untouched.
- ✅ If adding a new tool: catalog updated in [`campaigner/tools/CLAUDE.md`](campaigner/tools/CLAUDE.md) and readiness flipped in [`campaigner/CAMPAIGNER.md`](campaigner/CAMPAIGNER.md).
- ✅ If adding a new agent flow / runner: matching CronJob in [`kubefiles/`](kubefiles/) and Makefile target.

PR description must answer:

1. **What changed?** (the diff explains the _what_; you explain the _why_.)
2. **What's the test plan?** (golden scenarios run, manual approvals walk-through, etc.)
3. **What invariants did you check?** (HITL, dual-mode, deprecated rules.)

## Reporting bugs

Open an issue with:

- Steps to reproduce (exact `docker compose` / CLI commands).
- Expected vs actual.
- Relevant `agent_decisions` row IDs or `run_id`s if it's an agent issue.
- The flow (`daily_observe_propose` / `execute_approvals` / `weekly_creative_firehose`) if applicable.

## Security

- Never commit credentials. `.env`, GCP service account JSON, Meta access tokens are all gitignored.
- Token rotation: Meta access tokens expire ~60 days. See [`docs/plans/task-2.3-keys-and-quotas.md`](docs/plans/task-2.3-keys-and-quotas.md).
- Report vulnerabilities privately — email the project owner; do not open a public issue.

## Where to ask

- Architecture / spec questions: [`docs/plans/campaigner-spec.md`](docs/plans/campaigner-spec.md), then ask in PR comments.
- Decision history: [`docs/plans/decisions-log.md`](docs/plans/decisions-log.md).
- Anything not covered above: open an issue with the `question` label.

## License

By contributing, you agree your contributions are licensed under the project's [LICENSE](LICENSE).
