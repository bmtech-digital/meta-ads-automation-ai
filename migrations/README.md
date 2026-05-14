# Migrations

Schema for Campaigner's Postgres target (local dev + Supabase-compatible).

> **Status — 2026-04-19:** Local dev is **Postgres 16 in Docker**. Remote target (Supabase vs. Mongo vs. other) is still TBD per [decisions-log §1.4](../docs/plans/decisions-log.md#14-stagingprod-schema-sync--dual-write--ci-diff) amendment. SQL migrations are authored against standard Postgres so they port 1:1 to Supabase the day a project is provisioned — nothing in the SQL is Supabase-specific.

---

## 1. Layout

| Path                                                                                                | Purpose                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`001_businesses.sql`](001_businesses.sql) … [`008_schema_additions.sql`](008_schema_additions.sql) | Canonical schema. Applied in filename order. Source: [spec §10](../docs/plans/campaigner-spec.md).                                             |
| [`mongo/init_mongo.py`](mongo/init_mongo.py)                                                        | **Fallback only** — creates the equivalent 7 collections in Mongo. Not executed in current flow. Kept in case remote DB target flips to Mongo. |

The previous `_sql_pending_decision/` directory (dual-schema `public` + `staging` pattern from the pre-amendment §1.4) has been retired. Dual-schema offered no real isolation for single-DB local dev; if true pre-prod separation is needed later, it will come via a separate Supabase project, not a schema in the same cluster.

---

## 2. Running — local dev

```bash
bash scripts/migrate.sh                  # apply pending migrations
bash scripts/migrate.sh --status         # show applied vs pending
bash scripts/migrate.sh --dry-run        # plan without executing
```

The runner starts the `postgres` service if needed, waits for healthcheck, then applies migrations via `scripts/migrate.py` inside the `campaigner` container. Tracking table `schema_migrations` records filename + checksum. Editing an already-applied file is blocked — create a new numbered migration instead.

**Seed:**

```bash
bash scripts/seed_local.sh               # insert minimal fixture (one Aiweon businesses row)
```

**Reset local Postgres:**

```bash
docker compose stop postgres
docker compose rm -f postgres
docker volume rm meta-ads-automation-ai_pgdata
bash scripts/migrate.sh                  # re-init fresh
```

---

## 3. Running — Supabase (when the remote decision lands)

1. Create Supabase project; copy the Postgres URI from Project Settings → Database → Connection string → URI (Session pooler).
2. Set `DATABASE_URL=<supabase-uri>` in `.env`.
3. Run `bash scripts/migrate.sh`. The same runner, same SQL files, different target.
4. Apply RLS policies separately (see §5 below).

---

## 4. Schema summary

| #   | Table                | Purpose                                                                      | Spec §                                                                                 |
| --- | -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 001 | `businesses`         | Core tenant record (MVP: Aiweon only)                                        | [§10.1](../docs/plans/campaigner-spec.md#101-businesses)                               |
| 002 | `business_knowledge` | Structured business profile + questionnaire                                  | [§10.2](../docs/plans/campaigner-spec.md#102-business_knowledge)                       |
| 003 | `baselines`          | Rolling metric baselines per scope × window                                  | [§10.3](../docs/plans/campaigner-spec.md#103-baselines)                                |
| 004 | `approvals`          | HITL queue — every agent decision lands here                                 | [§10.4](../docs/plans/campaigner-spec.md#104-approvals--ה-hitl-queue)                  |
| 005 | `agent_decisions`    | Observability — every phase writes ≥1 row                                    | [§10.5](../docs/plans/campaigner-spec.md#105-agent_decisions--מנגנון-הדיווח-ר-סעיף-12) |
| 006 | `creative_gallery`   | Generated creatives + Meta creative IDs                                      | [§10.6](../docs/plans/campaigner-spec.md#106-creative_gallery)                         |
| 007 | `heartbeats`         | Cron liveness for runner failure alerts                                      | [§10.8](../docs/plans/campaigner-spec.md#108-heartbeats--cron-liveness)                |
| 008 | _additions_          | Token expiry, tracking verification, baseline confidence, guardrail override | [§10.9](../docs/plans/campaigner-spec.md#109-schema-additions-migration-008)           |

---

## 5. RLS (Row-Level Security)

Every table has `ENABLE ROW LEVEL SECURITY` set at creation time, mirroring [spec §10.7](../docs/plans/campaigner-spec.md#107-rls-policies-row-level-security).

- **Local dev:** The `campaigner` user owns the tables; table owners bypass RLS automatically. No policies needed.
- **Supabase:** The agent writes via `service_role`, which also bypasses RLS. Policies for frontend (`authenticated` role) are added in a separate post-migration SQL file when the frontend lands — not part of 001-007.

---

## 6. Editing discipline

- **Never edit an already-applied migration.** `scripts/migrate.py` blocks it via checksum mismatch and exits with status 2.
- Additive changes go in new numbered files (`008_*.sql`, `009_*.sql`, ...).
- Destructive changes (DROP COLUMN, altered CHECK constraints) — write the migration, but also update [spec §10](../docs/plans/campaigner-spec.md) so source-of-truth stays aligned.
- No raw DML in schema migrations (no `INSERT`s). Fixture data belongs in [`scripts/seed_local.sh`](../scripts/seed_local.sh).
