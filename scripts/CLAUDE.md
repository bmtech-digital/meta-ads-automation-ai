# Claude-at-`scripts/` — operational scripts

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

Operator-run scripts. Different from [`../runners/`](../runners/) (cron) and [`../campaigner/cli/`](../campaigner/cli/) (operator CLI for `approvals`):

| Folder | Caller | Purpose |
|---|---|---|
| `runners/` | k8s CronJob controller (Hetzner k3s) | Production agent flows |
| `campaigner/cli/` | operator at terminal | Manage approvals queue |
| `scripts/` (here) | operator, occasionally CI | One-off setup, validation, codegen, migrations |

## Catalog

### Local development

| Script | Purpose | Runs in |
|---|---|---|
| [`bootstrap_local_db.sh`](bootstrap_local_db.sh) | First-time spin-up of local Postgres + apply migrations + seed. | host (talks to `docker compose`) |
| [`migrate.sh`](migrate.sh) / [`migrate.py`](migrate.py) | Apply pending SQL migrations. `--status`, `--dry-run`, `--down` flags. Tracks via `schema_migrations` table; blocks edits to applied files via checksum. | `campaigner` container |
| [`seed_local.sh`](seed_local.sh) / [`seed_local.py`](seed_local.py) | Insert minimal fixture rows (one Aiweon `businesses` row). Idempotent. | `campaigner` container |
| [`seed_aiweon_knowledge.sql`](seed_aiweon_knowledge.sql) | Realistic `business_knowledge` row for Aiweon (read by tools and the web UI). | `psql` against local Postgres |
| [`validate_local_env.py`](validate_local_env.py) | Smoke-test the local stack — DB reachable, migrations applied, seed loaded. | host |

### Credentials & integrations

| Script | Purpose |
|---|---|
| [`validate_credentials.py`](validate_credentials.py) | Verify Anthropic + GCP (Vertex) + Meta credentials. Exits non-zero on the first broken credential — don't silently warn. Run after token rotation. |
| [`setup_gallery_bucket.py`](setup_gallery_bucket.py) | Idempotent setup of the GCS bucket Imagen writes to + the Postgres pointer rows. Run once per environment. |
| [`test.sh`](test.sh) | Run pytest inside the `campaigner` container. Used by CI and the local pre-commit. |

### Deploy

There are **no deploy scripts in this folder anymore.**

- Normal path: `git push origin main` → GitHub Actions builds + deploys to Hetzner k3s. See [`../docs/CI_CD.md`](../docs/CI_CD.md).
- Emergency hand-deploy (operator, when CI is down): `make build deploy` from the repo root.
- Structural cluster state (Deployments, CronJobs, Secrets, Ingress) is operator-managed from the Hetzner infra repo via `setup/hetzner/manifests/campaigner/apply.sh`. See [`../kubefiles/README.md`](../kubefiles/README.md).

The legacy `build_and_push_images.sh` and `deploy_prod.sh` scripts were removed when the GCP/GKE deployment retired (2026-05).

## How operators are expected to run things

Per [memory: "Run everything via Docker"](../CLAUDE.md), the canonical path is:

```bash
docker compose run --rm campaigner python scripts/validate_credentials.py
docker compose run --rm campaigner bash scripts/migrate.sh
```

Some scripts (`bootstrap_local_db.sh`, `validate_local_env.py`) run on the **host** because they orchestrate Docker — that's intentional, document any new host-side script the same way.

## Conventions

1. **`set -euo pipefail`** at the top of every Bash script. No exceptions.
2. **Idempotency where reasonable.** Setup scripts must be safe to re-run. Migration apply already enforces this via checksums.
3. **No interactive prompts.** Scripts may be called from CI. If you need confirmation, gate behind a `--yes` flag or an `OPERATOR_CONFIRMED=1` env var, with a clear error message when missing.
4. **Don't put schema migrations here.** SQL migrations live in [`../migrations/`](../migrations/) and run via `migrate.sh`. This folder is the runner; the data is upstairs.
5. **Don't add long-running daemons.** This folder is for finite, terminating commands. The `campaigner` container's `command:` belongs in [`../docker-compose.yml`](../docker-compose.yml), not here.

## Adding a new script

- Bash for shell orchestration; Python (`-m` modules where possible) for anything that touches the DB.
- Add an entry to the catalog above with one-line purpose.
- If the script ends up frequently used by the agent (not just operators), it probably belongs in [`../campaigner/tools/`](../campaigner/tools/) instead, with the JSON contract.
- If it ends up frequently used by humans managing approvals, it belongs in [`../campaigner/cli/`](../campaigner/cli/).

## Where truth lives

| Question | Read |
|---|---|
| Migration system internals | [`../migrations/README.md`](../migrations/README.md) |
| Credential setup (Anthropic / GCP-for-Vertex / Meta) | [`../docs/plans/task-2.3-keys-and-quotas.md`](../docs/plans/task-2.3-keys-and-quotas.md) |
| Deploy targets + cluster naming | [`../docs/CI_CD.md`](../docs/CI_CD.md) + [Makefile](../Makefile) (the `# --- Production cluster config ---` block) |
| Why local-dev uses ADC (not a service-account JSON) for Vertex | [root CLAUDE.md "Setup & Configuration"](../CLAUDE.md#setup--configuration) |
