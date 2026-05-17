# Claude-at-`campaigner/prompts/` — knowledge index + load order

> Loaded automatically when cwd is here. The files in this folder are the **knowledge** the agent reads at every invocation.

## What this folder is

Five files. Together they are the agent's brain — diagnostic method, decision tree, hard rules, creative process, and Hebrew voice. [`CAMPAIGNER.md`](../CAMPAIGNER.md) lists them in load order; this file is the one-screen index.

## Load order (flow-conditional — updated 2026-05-17)

`CAMPAIGNER.md` no longer says "read everything every invocation" — it lists which prompts each flow actually needs. The full matrix lives in [`../CAMPAIGNER.md`](../CAMPAIGNER.md) under *Before every flow — Load context*. Summary below.

| # | File | What it answers | Used by flow |
|---|---|---|---|
| 1 | [`performance-brain.md`](performance-brain.md) | "Is this campaign good enough?" — the two-gate model (leading vs lagging), data sufficiency (§6.4), portfolio thinking (§8 — Block 9) | A, C, F, G |
| 2 | [`decision-tree.md`](decision-tree.md) | "What label fits this state?" — winner / solid / loser / fatigued, and the action that follows. Per-campaign lanes §T0–§T9.1; **portfolio rebalance §T11** runs once per run after all per-campaign routes (Block 9, 2026-05-13). | A, E, G, H |
| 3 | [`guardrails.md`](guardrails.md) | "Am I allowed to propose this?" — 36 deterministic rules (also enforced by `check_guardrails.py`) + 5 judgment-only | **All flows** (universal) |
| 4 | [`creative-guide.md`](creative-guide.md) | "How do I generate the next batch?" — angles, prompt patterns, Andromeda-aware diversity | C only |
| 5 | [`hebrew-copy-style.md`](hebrew-copy-style.md) | "How do I write the Hebrew?" — operator rationale (§11), customer ad copy (§§2-9), voice defaults | All flows except B |
| 6 | [`competitive-research.md`](competitive-research.md) | "How do I research market prices + trending angles + new formats?" | D only |
| 7 | [`cpl-infrastructure.md`](cpl-infrastructure.md) | Pre-baked Israel-2026 CPL/CPA estimate (sub-vertical × geo × stage × offer × channel × season) | A, D — on-demand only when emitting `set_kpi_target` / KPI-comparison `alert` |
| 8 | [`kpi-benchmarks.md`](kpi-benchmarks.md) | Per-vertical KPI band (CPL/CPA/ROAS) — fallback when cpl-infrastructure can't match a sub-vertical | A, D — on-demand only |

## Two audiences, two voices

Per [`hebrew-copy-style.md`](hebrew-copy-style.md):

- **Operator-facing** (`rationale`, `summary` in `agent_decisions` / `approvals`) — plain Hebrew, no English acronyms in paragraph 1, glosses on first use thereafter. The reader may have no marketing background.
- **Customer-facing** (ad copy inside `new_creative` payloads) — Aiweon brand voice, Hebrew speech rhythm, no marketing-ese.

The cron one-line summary that goes to stdout is **English** — operators tail logs in English.

## Editing rules

1. **Anything you write here must align with [the three canonical docs](../../CLAUDE.md#-core-knowledge-read-before-editing):** `PERSONALITY.md`, `CAMPAIGN_EVALUATION.md`, `CAMPAIGN_BUILDING_RECOMMENDATIONS.md`. If a prompt drifts from those, fix the prompt — not the canonical doc.
2. **Section numbering is referenced from code and other prompts.** `decision-tree.md` §17, `guardrails.md` §14, `performance-brain.md` §6.4, `hebrew-copy-style.md` §11 — these section numbers appear in [`CAMPAIGNER.md`](../CAMPAIGNER.md), tools, and tests. If you renumber, grep first and update every caller.
3. **Hebrew prompt content stays in Hebrew.** Don't translate examples to English to "make them clearer to Claude" — that erodes the voice rules.
4. **Deprecated rules (CAMPAIGN_EVALUATION.md §8) must never reappear.** No "frequency > 3 = kill", no "1 ad set = 1 ad", no manual creative pruning in 48h. If a prompt sneaks one back, push back.
5. **Token weight matters.** Each prompt sits in the cached context for every tool turn during a flow that loads it. A 1,000-line addition to `decision-tree.md` is paid 76× per Flow A run (one read per turn after first). Prefer linking to the canonical doc when possible, and prefer splitting a new concept into its own file the matrix can route per-flow over bloating an always-loaded file.

## What NOT to put here

- **Code** — this folder is `.md` only. No `.py`, no shell.
- **Tool documentation** — that's [`../tools/CLAUDE.md`](../tools/CLAUDE.md).
- **Per-business knowledge** — that lives in the `business_knowledge` Postgres table, loaded by `load_business_knowledge.py`. Prompts are business-agnostic.
- **Examples that name a specific real campaign by name/ID.** Anonymize.

## Where truth lives

| Question | Read |
|---|---|
| The three canonical reference docs | [`../../docs/PERSONALITY.md`](../../docs/PERSONALITY.md), [`../../docs/CAMPAIGN_EVALUATION.md`](../../docs/CAMPAIGN_EVALUATION.md), [`../../docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../../docs/CAMPAIGN_BUILDING_RECOMMENDATIONS.md) |
| Why a guardrail looks the way it does | [`../../docs/CAMPAIGN_EVALUATION.md`](../../docs/CAMPAIGN_EVALUATION.md) |
| Where guardrails are also enforced in code | [`../tools/check_guardrails.py`](../tools/check_guardrails.py) |
| What the agent does with these | [`../CAMPAIGNER.md`](../CAMPAIGNER.md) |
