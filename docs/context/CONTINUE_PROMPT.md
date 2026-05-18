# Continue Prompt — Campaigner brain migration

**Updated:** 2026-05-18
**Branch:** `main` — pushed to `origin/main` at `04716d4`.
**Status:** PRD Steps 1 & 2 of 9 landed and pushed. Step 3 is the recommended next move.

## Where we are

Executing the nine-step migration in [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md). The audit that motivates it: [`docs/AUDIT_AND_MIGRATION.md`](../AUDIT_AND_MIGRATION.md).

Three commits landed this session, all on `main`:

- **107088a** — planning baseline (audit + PRD + line-ending normalize on `guardrails.md`).
- **00bf7f9** — PRD Step 1: stripped the interactive persona. Deleted `docs/PERSONALITY.md`, removed the persona block from root `CLAUDE.md`, retargeted every `Per PERSONALITY.md §X` citation in `CAMPAIGNER.md` and the prompt files to its actual operational source. Closes audit Finding 5.
- **04716d4** — PRD Step 2: built `config/flows.yaml` as the flow-wiring source of truth, plus `scripts/generate_from_flows.py` and `make generate` / `make verify-generated`. Generated cronjob manifests for the previously-undeployed Flows F (weekly self-audit), G (daily A/B decisions), H (midday health check). Closes audit Finding 1.

## What's next

**Recommended:** PRD **Step 3 — extract thresholds to `config/thresholds.yaml`** (medium effort, parallel-safe, no dependencies). Walk `prompts/*.md`, pull every hardcoded number into named YAML keys, replace the literal in markdown with a `{{name}}`-style reference, and stamp the YAML schema version on every `agent_decisions` row. Inventory to start from: PRD §Step 3 lists at least four — anti-flood caps, winner ratio `0.85`, utilization floor `0.5`, baseline band `±15%`. Discover the rest during the walk.

Other parallel-safe candidate: **Step 5 — structured plans table** (medium, no dependencies, also closes a finding).

**Do not start Step 4 first.** It's the large 2-3 week atomic per-flow split. The PRD wants Steps 1/2/3/5 landed first so the substrate exists.

## Operational TODO from this session

`make agent` has **not** been run since Step 2 landed. The new cronjob manifests for F/G/H are committed but not deployed. Until `make agent` runs, the PRD's "F/G/H run for 14 consecutive days in production" AC for Step 2 can't begin its clock. Time the deploy with monitoring; don't bundle it into a new step.

## Files to read first on restart

1. [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md) — the contract this migration runs against.
2. [`docs/AUDIT_AND_MIGRATION.md`](../AUDIT_AND_MIGRATION.md) — the narrative reasoning behind each step.
3. [`config/flows.yaml`](../../config/flows.yaml) + [`scripts/generate_from_flows.py`](../../scripts/generate_from_flows.py) — the registry pattern Step 3 will mirror for thresholds.
4. [`campaigner/CAMPAIGNER.md`](../../campaigner/CAMPAIGNER.md) — read the regenerated routing table and prompt-load matrix between the BEGIN/END sentinel comments to see the output style.
5. Run `make verify-generated` first — it must exit 0 before doing anything else.

## Decisions already made (don't relitigate)

- **Generator pattern**: source-of-truth YAML in `config/`, Python generator at `scripts/generate_from_flows.py`, sentinel-comment fenced regions in markdown targets, `make generate` (write) + `make verify-generated` (CI check, exits 1 on drift). Step 3 should follow the same pattern: `scripts/generate_from_thresholds.py` regenerates whatever materializations the thresholds drive (a reference table in `CAMPAIGNER.md`, possibly a `thresholds.py` Python constants module).
- **The agent never reads YAML directly.** Claude reads the generated markdown. PyYAML is a build-time dep, not a runtime invariant. This stays true for Step 3.
- **Historical references to PERSONALITY.md in `docs/plans/*` are left alone.** They're past-tense decision-log entries; the audit doc explains the deletion. Don't sweep them in a future step "for consistency."
- **`docs/audit-summary-he.html` is untracked and unrelated to the migration.** Leave it.

## Sentinel pattern to reuse

Generated regions inside human-edited markdown look like this:

```
<!-- BEGIN GENERATED:<sentinel-name> -->
... generator owns everything between the markers ...
<!-- END GENERATED:<sentinel-name> -->
```

The generator errors out if a sentinel pair is missing, so adding a new generated region is: (1) add the marker pair to the target file by hand once, (2) extend the generator to fill it. For Step 3, candidate sentinels: `thresholds:reference-table`, `thresholds:schema-version`.

## How the session ended

Cleanly, on a green tree. `make verify-generated` exits 0. `git status` shows only `docs/audit-summary-he.html` untracked (intentional).
