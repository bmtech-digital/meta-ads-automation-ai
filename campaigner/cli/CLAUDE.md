# Claude-at-`campaigner/cli/` — operator CLI

> Loaded automatically when cwd is here. Active alongside [`../CLAUDE.md`](../CLAUDE.md) and [root CLAUDE.md](../../CLAUDE.md).

## What this folder is

The **human** CLI. A different audience than [`../tools/`](../tools/):

| | `cli/` (this folder) | `tools/` |
|---|---|---|
| Caller | A person at a terminal | Claude headless via Bash |
| Default output | Human-readable tables | JSON only |
| Has `--json` flag | Yes (opt-in machine output) | No (always JSON) |
| Surface | One subcommand parser, one binary (`campaigner`) | One file per tool |
| Talks to Meta | Never. Read-only against Postgres + delegates to runners. | Yes (Flow B tools only) |

The wrapper at [`../../bin/campaigner`](../../bin/campaigner) shells into Docker and invokes `python -m campaigner.cli ...`.

## Subcommand surface

Defined in [`__main__.py`](__main__.py):

| Subcommand | Purpose | Mutates? |
|---|---|---|
| `list` | Show approvals, optionally filtered by status (`--pending`, `--approved`, `--status <s>`) | No |
| `approve <id>` | Move an `approvals` row from `pending` → `approved`. The execute runner picks it up next tick. | Yes (Postgres) |
| `reject <id> --reason "..."` | Move a row to `rejected` with required reason text. | Yes (Postgres) |
| `inspect <run-id-or-approval-id>` | Print the full decision trail. | No |
| `run <flow>` | Manually trigger a runner: `daily` / `execute` / `firehose`. Shells out to `runners/*.sh`. | Indirectly (the runner does) |

## Conventions

1. **Idempotent mutations.** `approve` on an already-approved row prints state and exits 0. Same for `reject` on a final row. This is on purpose — operators paste IDs and shouldn't get errors when they re-run.
2. **`FINAL_STATUSES`** in [`__main__.py`](__main__.py) is the source of truth for "this row is settled, do not mutate." Keep it in sync if a new terminal status is added to the schema.
3. **Output format default is human, opt into machine.** `--json` is a flag, not a separate subcommand. Tables use plain ASCII; no Unicode borders (terminals on Windows mangle them).
4. **`run <flow>` does not implement flow logic.** It delegates to [`runners/*.sh`](../../runners/). The CLI is glue, not duplication.
5. **CLI never calls Meta.** Approving doesn't execute — it queues. Execution is Flow B only. If you find yourself adding a `--execute-now` flag, stop and reconsider.

## Where truth lives

| Question | Read |
|---|---|
| Approval state machine | [`../../docs/plans/campaigner-spec.md`](../../docs/plans/campaigner-spec.md) §10.4 |
| Schema this CLI reads | [`../../migrations/004_approvals.sql`](../../migrations/004_approvals.sql), [`../../migrations/005_agent_decisions.sql`](../../migrations/005_agent_decisions.sql) |
| The runners this CLI shells to | [`../../runners/CLAUDE.md`](../../runners/CLAUDE.md) |
| The bash wrapper users actually invoke | [`../../bin/campaigner`](../../bin/campaigner) |
