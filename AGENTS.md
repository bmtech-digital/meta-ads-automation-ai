# AGENTS.md

> Open-standard agent guide ([agents.md](https://agents.md)). This file points to the project's canonical agent context.

## Source of truth: `CLAUDE.md`

This project uses Claude Code as its primary agent harness, so the canonical agent context lives at [`CLAUDE.md`](CLAUDE.md). Read it first — it covers project overview, personality (binding), core knowledge docs, architecture, ad accounts, tech stack, setup, and the per-folder navigation map.

If you are an agent **other than** Claude Code (Cursor, Aider, Codex, Continue, custom): treat `CLAUDE.md` as your `AGENTS.md`. Everything in it applies to you.

## Per-folder context (cwd-aware)

Each working folder has its own `CLAUDE.md` with folder-specific contracts. Claude Code loads them automatically based on cwd; other agents typically search up the tree from the file under edit. The full map is in [`CLAUDE.md` § "Per-folder navigation"](CLAUDE.md#-per-folder-navigation-claudemd-in-every-working-directory).

Quick index:

- [`campaigner/CLAUDE.md`](campaigner/CLAUDE.md) + per-subfolder (`tools/`, `lib/`, `prompts/`, `cli/`)
- [`runners/CLAUDE.md`](runners/CLAUDE.md), [`scripts/CLAUDE.md`](scripts/CLAUDE.md), [`tests/CLAUDE.md`](tests/CLAUDE.md)
- [`dockerfiles/CLAUDE.md`](dockerfiles/CLAUDE.md), [`kubefiles/CLAUDE.md`](kubefiles/CLAUDE.md)
- [`web/CLAUDE.md`](web/CLAUDE.md) + per-subfolder (`src/app/`, `src/components/`, `src/lib/`)
- [`webhook/CLAUDE.md`](webhook/CLAUDE.md)

## Hard rules every agent must follow

These are extracted from `CLAUDE.md` so any agent that only reads `AGENTS.md` still gets them:

1. **HITL is load-bearing.** The agent proposes; the human approves; only Flow B writes to Meta. Never bypass the `approvals` queue. Never execute autonomously.
2. **Hebrew rationale, English summary.** Operator-facing rationale fields are plain Hebrew (no English acronyms in paragraph 1). Cron one-line summaries are English.
3. **Run via Docker.** `docker compose run --rm campaigner <cmd>`. Host Python is for debugging, not workflow.
4. **Tools, not ad-hoc.** All Postgres + Meta + Vertex access is through `campaigner/tools/*.py` (agent) or `campaigner/lib/*` (library). No `psql`, no `curl`, no one-off scripts.
5. **Never edit applied migrations.** Schema changes go in new numbered files under [`migrations/`](migrations/).
6. **Respect the dual-mode adapter rule.** No direct `pg` or `@supabase/ssr` imports outside `web/src/lib/db/` and `web/src/lib/auth/`.
7. **Deprecated pre-Andromeda rules never come back.** See [`CLAUDE.md` § "Deprecated Pre-Andromeda Rules"](CLAUDE.md#deprecated-pre-andromeda-rules-never-reintroduce) and [`docs/CAMPAIGN_EVALUATION.md`](docs/CAMPAIGN_EVALUATION.md) §8.

## How to do common tasks

| Task | Where to look |
|---|---|
| Add a new agent tool | [`campaigner/tools/CLAUDE.md`](campaigner/tools/CLAUDE.md) "Adding a new tool" |
| Add a new web route | [`web/src/app/CLAUDE.md`](web/src/app/CLAUDE.md) "Adding a new route" |
| Add a schema migration | [`migrations/README.md`](migrations/README.md) §6 "Editing discipline" |
| Add a new prompt rule | [`campaigner/prompts/CLAUDE.md`](campaigner/prompts/CLAUDE.md) + the canonical doc the rule belongs to |
| Add a new cron flow | [`runners/CLAUDE.md`](runners/CLAUDE.md) "Adding a new runner" |
| Run tests | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| Deploy | [`Makefile`](Makefile) targets, [`kubefiles/CLAUDE.md`](kubefiles/CLAUDE.md) |

## Code style

- Python — `ruff` (config in [`pyproject.toml`](pyproject.toml)). 100-char lines. Format with `ruff format`.
- TypeScript — `tsc --noEmit` + `next lint`. 2-space indent. No default exports for components.
- Both — pre-commit hooks defined in [`.pre-commit-config.yaml`](.pre-commit-config.yaml). Install once: `pip install pre-commit && pre-commit install`.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint + test for both Python and Web on every PR. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys to GKE on push-to-main. Don't merge with red CI.

## What this file is NOT

- It's not a duplicate of `CLAUDE.md`. It points there.
- It's not folder-specific. Folder-specific context lives in each folder's `CLAUDE.md`.
- It's not a contributor guide for humans. That's [`CONTRIBUTING.md`](CONTRIBUTING.md).
