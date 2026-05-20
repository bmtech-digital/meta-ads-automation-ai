# Continue Prompt — Campaigner brain migration

**Updated:** 2026-05-20
**Branch:** `main` — local at `a0ddfad` (Step 5 just committed; not yet pushed).
**Status:** PRD Steps 1, 2, 3, **and 5** of 9 landed. **All four parallel-safe foundations (Phase A) are done.** Next move: **Step 4 (per-flow prompt split + shared brain)** — the large atomic structural change.

## Where we are

Executing the nine-step migration in [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md). The audit that motivates it: [`docs/AUDIT_AND_MIGRATION.md`](../AUDIT_AND_MIGRATION.md).

Commits on `main` (in PRD-step order):

- **107088a** — planning baseline (audit + PRD + line-ending normalize on `guardrails.md`).
- **00bf7f9** — PRD Step 1: stripped the interactive persona. Closes audit Finding 5.
- **04716d4** — PRD Step 2: `config/flows.yaml` + generator + cronjob manifests for F/G/H. Closes audit Finding 1.
- **9ebe2f7** — restored CONTINUE_PROMPT after a prior session.
- **0b58454** — PRD Step 3: `config/thresholds.yaml` + generator + `{{<domain>.<name>}}` placeholders in prompts + `lib/thresholds.py` constants module consumed by `log_decision.py` for schema-version stamping. Closes audit Finding 3.
- **a0ddfad** — PRD Step 5: structured plans trigger. Migration 032 adds metric / operator / threshold-by-name / sustained-days / proposed_action columns to `plans_carryover`; `propose_task --plan` writes the structured row alongside the approval; `load_active_plans.py` queries the table only (regex fallback gone). Closes audit Finding 6.

## What's next

**Recommended:** PRD **Step 4 — Per-flow prompt files + shared brain** (large effort — PRD calls it 2-3 weeks, so realistically multiple sessions). Atomic: per-flow split + shared-brain extraction ship together (PRD §Step 4 atomicity note).

Scope from PRD §Step 4:

- Split `CAMPAIGNER.md` (currently ~1,200 lines) into `prompts/flows/<flow_name>.md` per the template in PRD §2.3: Identity → When this runs → Inputs → What to check → What to compare → Decision rules → Constraints → Plans consumed/created → Outputs → Edge cases → Worked example.
- Extract every concept used by ≥2 flows into `prompts/shared-brain.md` — two-gate model, fatigue detection, portfolio rebalance, the diagnostic method, lane definitions referenced from multiple flows. Per-flow files reference shared concepts; flow-specific stays in the flow file.
- Update `config/flows.yaml` load matrix to declare which flows load `shared-brain.md` (most do).
- Shrink `CAMPAIGNER.md` to ~100 lines: thin index + universal preamble. Sections that moved are either deleted or replaced with a single line pointing at the new home.
- Run all currently-passing goldens under `tests/golden/` against the post-Step-4 brain before merging.

**Atomicity warning (PRD §6.2):** splitting per-flow WITHOUT the shared-brain extraction is not independently shippable — it distributes shared reasoning across N files without a home, creating exactly the drift risk Finding 10 warns about. The two halves of Step 4 must land together.

**If you'd rather defer Step 4:** Steps 6 (stable slugs), 7 (generated guardrails reference), 8 (concept index), 9 (onboarding cut-over) remain, but they all depend on Step 4's per-flow / shared-brain structure existing first. So Step 4 is the next bottleneck regardless.

## Operational TODOs accumulated

1. **`make agent` still pending from Step 2** — the new cronjob manifests for F/G/H are committed but not deployed. PRD's "F/G/H run for 14 consecutive days in production" AC for Step 2 can't start its clock until then.
2. **Migration 031 not yet applied in production** — from Step 3. `log_decision.py` writes `thresholds_schema_version` and will fail with "column does not exist" until 031 lands.
3. **Migration 032 not yet applied in production** — from Step 5 (this session). `propose_task --plan` writes the new columns and will fail with "column does not exist" until 032 lands.
4. **Push `a0ddfad`** — Step 5 is committed locally but not on `origin/main` yet.

Recommended order when shipping: push first, then apply migrations 031+032 in one window, then redeploy the agent image. The migrations are additive (new columns, all NULLable), so they're safe to land independently of the agent rolling out.

## Files to read first on restart

1. [`docs/plans/campaigner-migration-prd.md`](../plans/campaigner-migration-prd.md) §Step 4 — the contract for the next step.
2. [`campaigner/CAMPAIGNER.md`](../../campaigner/CAMPAIGNER.md) — what's being split. ~1,200 lines today; target is ~100.
3. [`campaigner/prompts/`](../../campaigner/prompts/) — what already exists in per-prompt form. `performance-brain.md`, `decision-tree.md`, `guardrails.md`, `creative-guide.md`, `hebrew-copy-style.md`, plus a few support files.
4. [`config/flows.yaml`](../../config/flows.yaml) `flows[*].prompts.always` / `prompts.on_demand` — Step 4 will add `shared-brain.md` to most flows' `always` list.
5. [`tests/golden/`](../../tests/golden/) — the regression surface. Step 4 atomicity note demands a green run against these before merge.
6. Run `make verify-generated` first — must exit 0 against both flows + thresholds.

## Decisions already made (don't relitigate)

- **Generator pattern**: YAML in `config/`, Python generator at `scripts/generate_from_<name>.py`, sentinel-comment fenced regions in markdown, `make generate` + `make verify-generated`. Steps 7-8 will add more generators following the same pattern.
- **The agent never reads YAML directly.** Claude reads the generated markdown reference tables in `CAMPAIGNER.md`. PyYAML is build-time only.
- **Threshold placeholder syntax is `{{<domain>.<name>}}`.** Prose carries the placeholder; the reference table resolves it.
- **`plans_carryover` is the plans store** (kept the name; new columns are additive). Renaming to `plans` would be cosmetic — not required by PRD §5 AC.
- **Step 5 trigger fields reference thresholds.yaml by dotted name** (`gate_2.winner_ratio`), not literals. The denormalized `trigger_threshold_value` column keeps historical triggers interpretable if a threshold is later renamed.
- **`propose_task --plan` validation is format-only.** The validator checks the dotted-name shape, not existence in `thresholds.yaml` — same convention as the markdown `{{...}}` placeholders.
- **The legacy `lib.plans.persist_from_approval()` regex-parsing helper STILL EXISTS** — it's the back-compat path for proposals that don't pass `--plan`. It's only `load_active_plans.py`'s fallback that was removed (per PRD AC). Don't delete `persist_from_approval` without a separate cleanup pass.
- **Historical references to PERSONALITY.md in `docs/plans/*` are left alone.** Past-tense decision-log entries; the audit doc explains the deletion.
- **`docs/audit-summary-he.html` is untracked and unrelated.** Leave it.

## Sentinel pattern (unchanged)

```
<!-- BEGIN GENERATED:<sentinel-name> -->
... generator owns everything between the markers ...
<!-- END GENERATED:<sentinel-name> -->
```

The generators error out if a sentinel pair is missing. For Step 4, no new generated regions are obviously needed — the per-flow split moves content between hand-written markdown files. The flow load matrix already exists (Step 2 generates it from `flows.yaml`).

## How the session ended

Cleanly. `a0ddfad` committed and tested:
- `python3 -m py_compile` passes on every modified file.
- `make verify-generated` exits 0 against both generators.
- `validate_structured_plan` smoke-tested across the contract surface (valid, missing trigger, bad operator, bad threshold_name, neither name nor value, value-only).
- `git status` shows only `docs/audit-summary-he.html` untracked (pre-existing, intentional).

Step 5 not yet on `origin/main` — first action next session should be `git push origin main`.
