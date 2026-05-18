# Campaigner Audit & Migration Plan

> **What this file is:** an audit of the Campaigner system as it stands today, plus the migration plan for evolving it. Read this to understand (1) what we found when we walked the codebase, (2) what we are keeping vs changing, (3) the order we plan to do the work in, and (4) the editing discipline that comes with the new structure.

> **When:** drafted 2026-05-18 against the codebase at commit `c6ea3c8`.

> **Audience:** anyone considering a change to this system — including future Claude sessions. The findings here are observations, not opinions; the migration plan is a proposal, not yet a commitment.

---

## TL;DR

Campaigner is a Claude Code Native agent: cron-driven, Claude reads markdown protocols and reasons at the top of the stack, calls Python CLI tools, writes proposals to a Postgres human-in-the-loop queue. The core paradigm is sound and we are keeping it.

The audit found that the system suffers from **organizational debt, not architectural breakage**. Three of eight documented flows are not deployed. Guardrail logic is duplicated across markdown and Python. Numeric thresholds are buried inside prose paragraphs where they cannot be tuned cleanly. Section-number markdown headings act as a fragile cross-file API. The personality doc is written for an interactive Claude conversation that does not exist in production. Forward-looking commitments are stored as Hebrew prose and regex-parsed back into agent memory.

The migration plan is incremental — nine steps, each independently shippable — and is designed to keep the agent paradigm intact while consolidating sources of truth.

A second pass (2026-05-18 pm) tested the plan against a sharper question: when a worker shows up with "I want to change the brain," will the plan make that easy? It does for tuning a number (Step 3) and for wiring a flow (Step 2), but the original Step 4 (per-flow file split) navigates the brain better while *distributing* shared reasoning across N files, where it can quietly diverge. We added a **shared brain** layer between `CAMPAIGNER.md` and the per-flow files, plus a **generated concept index** mapping every reasoning concept to the file that owns it. The plan grew from seven steps to nine.

---

## The audit

### How we looked

We walked the repository structure, read [`campaigner/CAMPAIGNER.md`](../campaigner/CAMPAIGNER.md) in full, read the per-folder `CLAUDE.md` files, read the runner scripts, sampled the prompt files (`performance-brain.md`, `decision-tree.md`, `guardrails.md`), cross-checked the [`kubefiles/`](../kubefiles/) directory against documented flows, and read the tool catalog at [`campaigner/tools/CLAUDE.md`](../campaigner/tools/CLAUDE.md). The goal was to understand how the system works end-to-end, where logic lives, which behaviors are user-visible vs suppressed, and where the organizational seams are.

### What works (and stays)

Four things should not change:

**The agent paradigm.** Claude reads markdown protocols, reasons, calls tools, writes output. This is the product. LangGraph deferment to v2 was a deliberate choice in the original spec. The flexibility this buys — adapting to edge cases, writing nuanced Hebrew rationale grounded in real numbers, evolving by editing a paragraph — is the reason this system is more useful than a rule engine would be.

**The HITL approval queue.** Every action lands in `approvals` for human review before any Meta write. The execute flow re-checks guardrails at execute time. This is the right pattern for a system that spends money.

**The two-gate evaluation philosophy.** Leading signals (hook rate, CTR) at the creative level in 48h-7d windows; lagging signals (CPA, ROAS, fatigue) at the campaign level post-Learning. Documented in [`docs/CAMPAIGN_EVALUATION.md`](CAMPAIGN_EVALUATION.md) and reified across the prompts.

**Python CLI tools as the agent's I/O surface.** Each tool is single-purpose, contract-bound, and outputs one JSON blob. The catalog can grow without the architecture changing.

### Findings

**Finding 1 — Deployment gap between documented and deployed flows.** [`CAMPAIGNER.md`](../campaigner/CAMPAIGNER.md) describes eight flows (A through H). [`runners/`](../runners/) contains bash entrypoints for all eight. [`kubefiles/`](../kubefiles/) contains CronJob manifests for only four: `agent_cronjob_daily_observe.yaml`, `agent_cronjob_execute_approvals.yaml`, `agent_cronjob_weekly_competitive_research.yaml`, `agent_cronjob_weekly_creative.yaml`. Flows F (weekly self-audit), G (daily A/B-test decisions), and H (midday health check) are written but not deployed. There is no single registry tying documentation to deployment, so the gap is invisible until cross-checked manually. This is the most likely single root cause of "the agent isn't talking to me enough" — three intended touchpoints per week are missing.

**Finding 2 — Duplicated sources of truth for guardrails.** Guardrail rules exist in two places: [`campaigner/prompts/guardrails.md`](../campaigner/prompts/guardrails.md) (~51k chars, 36 deterministic rules plus 5 judgment-only) and [`campaigner/tools/check_guardrails.py`](../campaigner/tools/check_guardrails.py) (~128k chars, the enforcement code). The prompts folder's `CLAUDE.md` explicitly warns *"if you renumber, grep first and update every caller"* — an admission that the two are expected to stay synchronized manually. Drift is not just possible; it is invited.

**Finding 3 — Hardcoded numbers buried in prose.** Anti-flood caps live as a markdown table in `CAMPAIGNER.md` Step 5 (`< 50 → 2, 50-500 → 5, > 500 → 10`). The winner ratio (`CPA ≤ target × 0.85`) is in `performance-brain.md` §5. The utilization floor for new-creative suppression (`utilization_7d < 0.5`) is in `guardrails.md` §19. None of these values are addressable as configuration. Tuning any of them requires editing prose, which has no version stamp on the value itself, so retroactive "why did this proposal fire?" cannot be answered after a change.

**Finding 4 — Section numbers used as cross-file API.** Markdown headings like `§T0r`, `§T-1`, `§T_PE` are referenced from code (`check_guardrails.py`), from other prompts (`performance-brain.md` cites `decision-tree.md §17`), and from runner prompt strings. The `prompts/CLAUDE.md` explicitly says *"If you renumber, grep first and update every caller."* This is the smell of using markdown headings as identifiers — they look stable, but they are not.

**Finding 5 — Personality doc addressing the wrong audience.** [`docs/PERSONALITY.md`](PERSONALITY.md) is titled "Campaign Diagnostician for Aiweon" and opens with *"the local Claude talking to Roi (Bemtech) about Meta campaigns."* The rules inside — "ask the business intent before prescribing," "when Roi pushes back, do not defend, revisit," "translate into a decision or a question back to Roi" — assume an interactive conversation with a human in the room. The production campaigner runs headless via cron with no conversation, so these rules cannot apply. The root [`CLAUDE.md`](../CLAUDE.md) amplifies the confusion by binding the same persona to interactive Claude sessions in this repo, conflating two audiences as one role.

**Finding 6 — Plans parsed from prose.** [`load_active_plans.py`](../campaigner/tools/load_active_plans.py) recovers forward-looking commitments by reading recent Hebrew rationale fields in `approvals` and extracting lines that start with `תוכנית:`. The agent's memory is, literally, parsed from its own writing. There is no `plans` table; the trigger condition ("if utilization climbs back above 80%") lives only in prose and has to be re-interpreted on each run. Operators have no structured view of what the agent has committed to.

**Finding 7 — Multiple suppression layers stack to silence creative alerts.** Three independent gates each muzzle `new_creative` proposals: guardrail §19 (drops `new_creative` when `utilization_7d < 0.5`), guardrail §28 (prefers redeploy over generation when `viable_unused_count ≥ 3`), and the "average" lane in `performance-brain.md` §5 (explicit instruction: *do not touch* when KPI is in baseline ±15% and pool is healthy). Each gate is individually defensible; stacked, they produce the observed "the agent never suggests new creatives" behavior. Flow C (the creative firehose) also runs only Mondays — creative thinking on a Wednesday produces silence by design.

**Finding 8 — Token-cost workarounds reveal organizational shape.** The "skip-on-no-change gate" (Flow A Step −1), the "tool-call discipline: never call the same tool twice with the same args" rule, the "load only the prompts your flow needs" matrix — these are not features. They exist because the brain is large and re-read on every tool turn during a 76-turn run. Reorganizing the brain into smaller, flow-scoped files would reduce the need for them.

**Finding 9 — Diagnostic philosophy mixed with runtime instructions.** `PERSONALITY.md` and `performance-brain.md` both contain a mix of (a) how to diagnose, (b) what to say to operators, and (c) what not to do. The same paragraph can be advisory to the LLM, structural for the pipeline, and educational for a human reader. This mixing is why the docs are hard to revise — every edit weighs three audiences at once.

**Finding 10 — No path for "I want to change the brain."** Adding or revising a piece of reasoning — a new diagnostic angle, a different fatigue rule, a swap of the two-gate philosophy for cohorts — requires editing across `performance-brain.md`, `decision-tree.md`, the affected section of `CAMPAIGNER.md`, and sometimes `guardrails.md`, with no map telling a worker which files own which concepts. Tuning a number (Finding 3) and adding a flow (Finding 1) are the easy cases; *changing how the agent thinks* is the unaddressed one. The per-flow split proposed in the original Step 4 reshuffles this surface area but does not reduce it; on its own it can *increase* drift risk by distributing shared reasoning across N flow files where it can quietly diverge. The remedy is in "The target" below — a shared brain layer plus a generated concept index.

---

## The target

What we are moving toward. This is a proposal, not yet adopted in code.

### Four layers

Every piece of the brain belongs to exactly one of four layers. Knowing which layer a piece belongs to tells you which file to edit when it changes.

1. **The agent's brain (markdown).** Under [`campaigner/prompts/`](../campaigner/prompts/) and [`campaigner/CAMPAIGNER.md`](../campaigner/CAMPAIGNER.md). Diagnostic methods, decision-tree lanes, per-flow protocols, voice rules. Where *judgment* lives.
2. **Numbers and configuration (YAML).** `config/thresholds.yaml` and `config/flows.yaml`. Every numeric threshold and every flow's wiring. Loaded by the agent at the start of every run.
3. **CLI tools (Python).** Under [`campaigner/tools/`](../campaigner/tools/). Single-purpose, agent-callable, contract-bound. The agent's I/O surface. No business logic.
4. **Code-enforced contracts (Python).** [`check_guardrails.py`](../campaigner/tools/check_guardrails.py), [`execute_task.py`](../campaigner/tools/execute_task.py), validators in [`campaigner/lib/`](../campaigner/lib/). The only place where deterministic enforcement lives. Small on purpose.

### Source-of-truth map

For every kind of fact, exactly one file is the source. Other copies are *generated*.

| Kind of fact | Source of truth | Generated copies |
|---|---|---|
| Schedule, runner, prompt-load matrix for a flow | `config/flows.yaml` | `kubefiles/agent_cronjob_*.yaml`, the flow table in `CAMPAIGNER.md` |
| Numeric thresholds | `config/thresholds.yaml` | Markdown references the threshold by name; no literal copies |
| Deterministic guardrails | `check_guardrails.py` | `prompts/guardrails.md` (auto-generated reference) |
| Decision-tree lanes | `prompts/decision-tree.md` | Cross-referenced by stable slug; no parallel code definition |
| Voice & personality rules | `prompts/hebrew-copy-style.md` (single file) | None |
| Per-flow protocol | `prompts/flows/<flow_name>.md` (one file per flow) | The flow index in residual `CAMPAIGNER.md` |
| Cross-flow reasoning (two-gate, fatigue, diagnostic method, shared lanes) | `prompts/shared-brain.md` | Referenced from per-flow files by stable slug |
| Concept-to-file index | Frontmatter slugs in each `.md` definition | `prompts/CONCEPTS.md` (auto-generated by `make generate`) |
| Database schema | `migrations/*.sql` | None |
| Forward-looking commitments | `plans` Postgres table | Quoted in Hebrew rationale as `תוכנית:` lines for human readers |

### Per-flow prompt template

Each flow lives in its own file under `campaigner/prompts/flows/<flow_name>.md`, following a uniform template: **Identity → When this runs → Inputs available (Tools / Data sources / Reference docs) → What to check → What to compare → Decision rules → Constraints → Plans this flow consumes or creates → Outputs required (DB / stdout / exit code) → Edge cases → Worked example**. ~300-500 lines per file. Together with the shared brain (next section), they replace most of `CAMPAIGNER.md`, which shrinks to a thin index plus universal preamble.

### The shared brain layer

Between `CAMPAIGNER.md` (thin index + universal preamble) and `prompts/flows/<flow_name>.md` (per-flow protocols) sits `prompts/shared-brain.md` — the home of any reasoning used by more than one flow. The two-gate model, fatigue detection logic, portfolio-rebalance heuristics, the diagnostic method itself, lane definitions used by multiple flows. The per-flow files describe *when and how* their flow applies the shared reasoning, and add only what is genuinely flow-specific.

The discipline that keeps this honest is in Rule 11 below — additions to the shared brain must demonstrate two-flow use; single-flow concepts stay in the flow file. Without that rule, the shared brain becomes the path of least resistance and the file devolves into the new `CAMPAIGNER.md` problem under a different name. The load matrix in `flows.yaml` (Step 2) declares whether each flow loads the shared brain (most do); per-flow files reference its concepts by stable slug (Step 6).

### Concept index

`prompts/CONCEPTS.md` is a generated artifact: for every named concept in the brain (slugged via frontmatter), it lists the file that owns the definition and the files that reference it. A worker arriving with "I want to change how fatigue is detected" reads `CONCEPTS.md`, finds `fatigue_detection → shared-brain.md (owner); flows/daily_observe.md, flows/weekly_creative.md (consumers)`, and knows exactly what to edit and what to verify. The file is generated by `make generate` from frontmatter slugs (Step 6). Hand-editing is rejected at review for the same reason hand-editing the flow table in `CAMPAIGNER.md` is rejected — the source is elsewhere.

This is a different artifact from the per-folder `CLAUDE.md` files. Those are *navigation* indices: "here is what this folder does, here is its contract." `CONCEPTS.md` is the orthogonal axis: "here is where reasoning about X lives, regardless of folder." Both exist; neither replaces the other.

### Plans as structured objects

A `plans` Postgres table. Each row carries a structured trigger (metric, operator, threshold-by-name, sustained-days) and a `proposed_action` payload template. When the agent commits to a forward-looking step, it writes a row *and* the Hebrew `תוכנית:` line. The row is for the agent's future self; the line is for the operator. Subsequent runs query the table — they do not parse prose. Operators get a `/plans` UI page.

### Stable slugs

Cross-file references use stable string identifiers: `scale_up_candidate`, `creative_pool_exhausted`, `no_new_creative_when_underspending`, `daily_observe_propose`. Markdown headings can be renumbered freely; the slug is the API.

### Voice consolidation

One voice file for the production agent — `prompts/hebrew-copy-style.md`. The interactive-Claude persona is removed entirely. No `CLAUDE.md` at any level assigns Claude a role. Interactive Claude in this repository is a coding assistant for the codebase, nothing more.

### Flow registry

`config/flows.yaml` declares every flow: name, schedule, timezone, runner, trigger prompt, prompts loaded, descriptions. `make generate` produces CronJob manifests, the flow table in `CAMPAIGNER.md`, and the flow index in `docs/ARCHITECTURE.md`. Adding a flow means adding a YAML block.

---

## Migration plan

Seven steps. Each is independently shippable and leaves the system in a more navigable state than before.

### Step 1 — Strip the interactive persona

**Effort:** small · **Risk:** low · **Unlocks:** clean separation between production agent and interactive Claude.

Delete the `🎙️ How You Talk — Personality (binding)` section from the root `CLAUDE.md`. Rewrite `docs/PERSONALITY.md` to voice-only content, or fold its surviving rules into `prompts/hebrew-copy-style.md`. Update navigation tables in the various `CLAUDE.md` files.

### Step 2 — Build the flow registry

**Effort:** medium · **Risk:** low-medium · **Unlocks:** Flows F/G/H deployed; no more wiring drift.

Create `config/flows.yaml` with the eight flows. Build a `make generate` target that produces CronJob manifests and flow tables. Deploy F/G/H as a side effect of regenerating from the new source.

### Step 3 — Extract thresholds

**Effort:** medium · **Risk:** low · **Unlocks:** tunable without code change, version-stamped retroactive answers.

Create `config/thresholds.yaml`. Walk the prompts and pull every hardcoded number into the YAML, replacing the literal with a named reference. Add a `load_thresholds.py` tool and update `CAMPAIGNER.md` Step 1 to load it at the start of every run. Stamp the schema version on every `agent_decisions` row.

### Step 4 — Per-flow prompt files + shared brain

**Effort:** large · **Risk:** medium · **Unlocks:** navigable per-flow docs, a single home for cross-flow reasoning, token-cost relief.

Split `CAMPAIGNER.md` into `prompts/flows/<flow_name>.md` files following the template. **In the same pass**, extract every concept used by more than one flow into `prompts/shared-brain.md` — the two-gate model, fatigue detection, portfolio rebalance, the diagnostic method, lane definitions referenced from multiple flows. Per-flow files describe when and how their flow applies the shared reasoning and add only what is genuinely flow-specific. Shrink `CAMPAIGNER.md` to its residual index plus universal preamble (~100 lines). Update the runner scripts' trigger prompts to reference the new files. The load matrix in `flows.yaml` (Step 2) declares whether each flow loads the shared brain (most do) and which flow file to load.

Splitting per-flow without the shared-brain extraction is **not** independently shippable — it would distribute shared reasoning across N files without a home, creating exactly the drift risk Finding 10 warns about. The two halves of Step 4 ship together.

### Step 5 — Structured plans table

**Effort:** medium · **Risk:** low · **Unlocks:** queryable agent memory, `/plans` UI page.

Add the `plans` migration. Update `propose_task.py` to accept `--plan`. Update `load_active_plans.py` to query the table. Optionally backfill from existing rationale; otherwise let open prose-plans expire naturally.

### Step 6 — Stable slugs

**Effort:** medium · **Risk:** low · **Unlocks:** safe renumbering, clearer cross-references.

Add slugs as frontmatter to existing lane and guardrail definitions. Walk every cross-reference (in code, in prompts, in tests) and migrate from section numbers to slugs. Section numbers may remain in markdown headings for human navigation but stop being load-bearing.

### Step 7 — Generated reference docs

**Effort:** medium · **Risk:** low · **Unlocks:** no drift between code and prose.

Auto-generate `prompts/guardrails.md` from `check_guardrails.py`'s rule definitions. Auto-generate the lane reference from `decision-tree.md`'s frontmatter. Wire both into `make generate`. The hand-edited markdown reference goes away.

### Step 8 — Generated concept index

**Effort:** medium · **Risk:** low · **Unlocks:** "I want to change X" becomes one file-lookup, not a grep across the brain. Closes Finding 10.

Depends on Step 6 (stable slugs) being applied across the brain. Extend `make generate` to walk the markdown tree under `prompts/` and emit `prompts/CONCEPTS.md`: for every slug, list owner file + line, consumer files + lines. Fail the build on a duplicate slug, on a slug referenced but never defined, or on a definition with no slug. The per-folder `CLAUDE.md` files remain navigation indices; `CONCEPTS.md` is the orthogonal axis.

### Step 9 — Onboarding cut-over

**Effort:** small · **Risk:** low · **Unlocks:** the new structure is the entry point a worker actually finds.

Rewrite the navigation table in the root `CLAUDE.md` and the "Where truth lives" tables in the per-folder `CLAUDE.md` files to point at `shared-brain.md`, `flows/<flow_name>.md`, `CONCEPTS.md`, and `thresholds.yaml`. Remove pointers to the residual sections of `CAMPAIGNER.md` that no longer carry weight. A new contributor reading `CLAUDE.md` should land on the shared brain or the concept index, not on the legacy spec.

---

## Editing rules going forward

Once the structure is in place, these rules keep it organized. They describe the target discipline; adopting them now (mid-migration) is fine — they don't depend on the migration being complete.

**1. One change, one home.** Every change lives in exactly one place. Threshold tweak → `thresholds.yaml`. New diagnostic angle → the relevant flow file or lane definition. New deterministic guardrail → `check_guardrails.py` plus a test. Voice change → the single voice file. Wiring change → `flows.yaml`. If a change requires touching two places, the filing system is wrong — consolidate first, then make the change.

**2. Numbers belong in YAML.** When you find a hardcoded number inside a markdown paragraph, that is drift in progress. Extract it. Markdown quotes the threshold by name; the value lives only in YAML.

**3. Markdown is for judgment; code is for what must be enforced.** Most logic stays in markdown because the agent does the reasoning. The exceptions are things that must be enforced *deterministically at execute time* — guardrails, schema validation, payload contracts. Those stay in code; their markdown documentation is generated. Do not back up a markdown rule with a code check unless the rule is genuinely deterministic.

**4. Stable slugs, not section numbers.** Cross-file references use stable string identifiers. Section numbers may appear in headings for navigation but are not load-bearing.

**5. One voice file.** All personality and voice guidance for the production agent lives in one file. No interactive-Claude persona exists. No `CLAUDE.md` at any level assigns Claude a role.

**6. The flow registry is the wiring authority.** Adding a flow means adding a `flows.yaml` entry and running `make generate`. Hand-editing CronJob manifests or flow tables is rejected at review — those are generated artifacts.

**7. Additions replace; they do not accrete.** When a new way to handle a situation is added, the predecessor is removed or the doc explicitly says why both coexist. Do not add the eighth amendment to an already-amended paragraph. Rewrite it.

**8. Token weight is an editorial discipline.** Every always-loaded prompt is paid for on every tool turn. A 500-line addition to `decision-tree.md` is paid 76 times per Flow A run. Write tight, link to canonical docs, prefer splitting a new concept into its own file the load matrix can route per-flow.

**9. Plans are structured, not parsed.** When the agent writes a forward-looking commitment in a rationale, it also writes a structured `plans` row. The Hebrew rationale is for the operator; the row is for the agent's future self.

**10. Test fixtures for deterministic layers, golden runs for the agent layer.** Code-enforced guardrails and tools have unit tests. The agent's reasoning layer is tested via golden run transcripts under `tests/golden/` — recorded input state with an expected proposal set. Goldens catch behavior drift even though the underlying reasoning is probabilistic.

**11. The shared brain is for cross-flow reasoning only.** A concept enters `shared-brain.md` only after a second flow needs it. Single-flow concepts stay in the flow file. The shared brain is the path of least resistance — without this rule, every new concept drifts upward and the file becomes the new `CAMPAIGNER.md` problem under a different name. When in doubt, start in the flow file and promote on the second use. Demotion (a concept that turns out to be single-flow after all) is equally legitimate; the rule cuts both directions.

**12. The concept index is generated, not written.** `prompts/CONCEPTS.md` is built from frontmatter slugs by `make generate`. Hand-edits are rejected at review. If a concept does not appear in the index, the fix is to add a slug to its definition — not to edit the index. The same applies to `prompts/guardrails.md` after Step 7 lands.

---

## What we are explicitly NOT changing

To protect the agent paradigm from drift during the migration:

- Claude reads markdown, reasons, calls tools, writes output. The LLM stays at the top of the stack.
- The HITL approval queue. Every action still requires human approval.
- The two-gate evaluation philosophy (leading at creative level, lagging at campaign level).
- The Python CLI tools as the agent's I/O surface.
- The audit log (`agent_decisions`) and the heartbeat-based observability.
- The Hebrew-first voice for operator-facing output.

---

## Updating this file

This file is the working record of the audit and migration plan. Updates follow Rule 7 — rewrite the relevant section in place, do not append amendments. The status line at the top is updated whenever findings or the plan change materially. Where this doc conflicts with older prose elsewhere in the repo, this doc reflects the current direction, and the older prose is the next thing to fix.
