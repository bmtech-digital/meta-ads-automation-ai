# Continue Prompt — Campaigner brain migration

**Updated:** 2026-05-18
**Branch:** `main` — Step 3 about to be pushed.
**Status:** PRD Steps 1, 2, 3 of 9 landed. The four "parallel-safe" foundations are now 3/4 done; Step 5 (structured plans table) is the remaining parallel-safe one before Step 4's big atomic split.

## Where we are

Executing the nine-step migration in [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md). The audit that motivates it: [`docs/AUDIT_AND_MIGRATION.md`](../AUDIT_AND_MIGRATION.md).

Commits on `main`:

- **107088a** — planning baseline (audit + PRD + line-ending normalize on `guardrails.md`).
- **00bf7f9** — PRD Step 1: stripped the interactive persona. Closes audit Finding 5.
- **04716d4** — PRD Step 2: `config/flows.yaml` + `scripts/generate_from_flows.py` + `make generate` / `make verify-generated`. Generated cronjob manifests for the previously-undeployed Flows F/G/H. Closes audit Finding 1.
- **9ebe2f7** — restored CONTINUE_PROMPT.md from a prior session.
- **(this commit)** — PRD Step 3: `config/thresholds.yaml` + `scripts/generate_from_thresholds.py`. ~28 rule thresholds extracted across 6 domains (anti-flood, gate_1, gate_2, learning, utilization, scaling, ab_test, solid_strong, portfolio, feedback). Generator emits a reference table + schema-version banner into `CAMPAIGNER.md` between sentinel comments, plus a generated Python constants module at `campaigner/lib/thresholds.py`. Migration `031_thresholds_schema_version.sql` adds the column; `log_decision.py` stamps `SCHEMA_VERSION = "1.0.0"` on every row. Markdown prose in `performance-brain.md`, `decision-tree.md`, `guardrails.md`, and `CAMPAIGNER.md` Step 5 now uses `{{<domain>.<name>}}` placeholders instead of literals. Closes audit Finding 3.

## What's next

**Recommended:** PRD **Step 5 — structured plans table** (medium effort, parallel-safe, closes Finding 6). The last of the four parallel-safe foundations (1/2/3/5) before Step 4's large atomic split. Inventory in PRD §Step 5:

- New `plans` migration: trigger (metric, operator, threshold-by-name, sustained-days) + `proposed_action` payload template + owning-flow + status (`active`/`fired`/`expired`/`withdrawn`).
- `propose_task.py` accepts `--plan` and writes the row alongside the approval.
- `load_active_plans.py` queries the table; remove the prose-parsing path.
- Trigger references threshold values **by name** — directly leverages Step 3.

Alternative: jump straight to **Step 4 (per-flow split + shared brain)**. It's the large atomic 2-3 week change. The PRD recommends doing Step 5 first because (a) it's smaller and closes a finding, (b) the structured trigger schema benefits from naming thresholds the same way the generated reference does, and (c) Step 4 has dependencies on the substrate that Step 2 already provided.

## Operational TODO from this session and prior

1. **`make agent` still pending from Step 2** — the new cronjob manifests for F/G/H are committed but not deployed. The PRD's "F/G/H run for 14 consecutive days in production" AC for Step 2 can't begin its clock until deploy. Bundle with the next deploy window, don't bundle into a new step.

2. **Run migration 031 in production** — `scripts/migrate.sh` (or whatever the prod migration path is) needs to apply `031_thresholds_schema_version.sql` to add the `agent_decisions.thresholds_schema_version` column. Until applied, `log_decision.py` INSERTs will fail with `column "thresholds_schema_version" does not exist`. Re-deploy the agent image only **after** the migration lands.

## Files to read first on restart

1. [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md) — the contract.
2. [`config/thresholds.yaml`](../../config/thresholds.yaml) + [`scripts/generate_from_thresholds.py`](../../scripts/generate_from_thresholds.py) — the pattern Step 5's trigger schema can build on if it wants threshold-name references.
3. [`config/flows.yaml`](../../config/flows.yaml) + [`scripts/generate_from_flows.py`](../../scripts/generate_from_flows.py) — the prior generator. Same sentinel pattern.
4. [`campaigner/CAMPAIGNER.md`](../../campaigner/CAMPAIGNER.md) — read the generated **Thresholds — Reference** section. Skim a few of the per-flow sections to see the `{{...}}` placeholder usage in context.
5. Run `make verify-generated` first — it must exit 0 (both flows and thresholds checks).

## Decisions already made (don't relitigate)

- **Generator pattern**: source-of-truth YAML in `config/`, Python generator at `scripts/generate_from_<name>.py`, sentinel-comment fenced regions in markdown targets, `make generate` (write) + `make verify-generated` (CI check, exits 1 on drift).
- **The agent never reads YAML directly.** Claude reads the generated markdown reference tables in `CAMPAIGNER.md`. PyYAML is a build-time dep, not a runtime invariant. This stays true for Step 5.
- **Threshold placeholder syntax is `{{<domain>.<name>}}`.** Prose carries the placeholder; the generated reference table resolves it. Operators see the resolved value in `CAMPAIGNER.md`.
- **Threshold schema version is stamped by `log_decision.py`, not passed by the agent.** The agent doesn't need to call `load_thresholds`; the constants module is imported and `SCHEMA_VERSION` is written on every row automatically. The `load_thresholds.py` tool exists for diagnostic purposes only.
- **Historical references to PERSONALITY.md in `docs/plans/*` are left alone.** Past-tense decision-log entries; the audit doc explains the deletion. Don't sweep them for consistency.
- **`docs/audit-summary-he.html` is untracked and unrelated to the migration.** Leave it.
- **The Step 3 inventory is a focused first cut (~28 thresholds across 6 domains).** Numbers in `cpl-infrastructure.md` (geo / season / offer modifiers) are research data, not rule thresholds — intentionally not moved. Example-JSON payloads in prompts that include numerics like `"cpa_vs_target":0.85` are illustrations, not rules — also intentionally not moved.

## Sentinel pattern (unchanged from Step 2)

Generated regions inside human-edited markdown:

```
<!-- BEGIN GENERATED:<sentinel-name> -->
... generator owns everything between the markers ...
<!-- END GENERATED:<sentinel-name> -->
```

The generators error out if a sentinel pair is missing. Adding a new generated region is: (1) add the marker pair to the target file by hand once, (2) extend the generator to fill it.

For Step 5, the candidate sentinel(s) are TBD — the structured plans schema may not need a generated reference at all (it's a DB table, not prose), but the `propose_task --plan` payload schema could be documented via a generated reference if it ends up complex.

## How the session ended

Cleanly, on a green tree. `make verify-generated` exits 0 against both generators. `git status` shows only `docs/audit-summary-he.html` untracked (intentional, pre-existing).
