# Golden-set E1 — fixture library

> **Source:** [campaigner-backend-prd §3.3 E1](../../docs/plans/campaigner-backend-prd.md) (13 scenarios, synthetic starter set).
> **Purpose:** regression gate for any change to `CAMPAIGNER.md`, `prompts/*.md`, or guardrails. Every change must run this set in `--dry-run` and match the expected outcome.
> **Status (2026-04-19):** Phase-0 scaffolding. Snapshots are hand-authored from spec examples; real captures promoted after the 7-day dry-run (Phase 4, per PRD §3.3).

## Fixture schema

Every `NN_<scenario>.json` file has this shape:

```json
{
  "id": "01_gate1_kill_hook_low",
  "title": "one-line human-readable description",
  "source": "link to the authoritative doc section that defines this scenario",
  "tagged_gate": "gate_1_creative | gate_2_campaign | data_sufficiency | guardrail | human_review",

  "input": {
    "business_id": "<uuid>",
    "campaign": { ... },
    "ad": { ... optional ... },
    "insights_48h": { ... or insights_7d ... },
    "baselines": [ ... ],
    "extra_signals": { ... scenario-specific ... }
  },

  "expected": {
    "decision_class": "observation | diagnosis | proposal | rejection | skip | error",
    "proposal": {
      "task_type": "...",
      "target_kind": "campaign | adset | ad | creative | account",
      "target_id": "<meta-id or '@input.ad.id' reference>",
      "urgency": "low | medium | high | urgent",
      "payload_keys": ["list of keys that must appear in payload JSON"],
      "rationale_must_contain": ["Hebrew | English substrings"],
      "rationale_must_not_contain": ["forbidden substrings — deprecated rules"],
      "requires_human_review": false
    },
    "guardrail_violations": ["list-of-rule-names-from-guardrails.md"],
    "followup_proposal": { ... optional — second proposal expected ... }
  },

  "notes": "free-form — reasoning path, cross-refs, edge cases"
}
```

### Field meanings

- `tagged_gate` — which evaluation layer produced the decision. PRD requires that the `--dry-run` replay match both the decision class AND the gate tag.
- `expected.decision_class` — maps to `agent_decisions.decision_type` enum.
- `expected.proposal` — present when decision_class is `proposal`. Describes what the `approvals` row should look like.
- `expected.proposal.requires_human_review` — MVP stores this inside `approvals.payload` (no dedicated column per spec §10.4). Schema evolution deferred.
- `expected.guardrail_violations` — present when decision_class is `rejection`. Every name must exist in [guardrails.md](../../campaigner/prompts/guardrails.md).
- `rationale_must_not_contain` — deprecated-rule canaries. If a prompt regresses and the agent's rationale mentions "Frequency > 3" as a kill trigger, the canary fires.

### Scenario inventory (PRD §3.3 E1)

| #   | file                             | gate             | class     | pass criterion                                                                            |
| --- | -------------------------------- | ---------------- | --------- | ----------------------------------------------------------------------------------------- |
| 01  | `01_gate1_kill_hook_low.json`    | gate_1_creative  | proposal  | `pause_adset` on the ad, rationale cites hook rate                                        |
| 02  | `02_winner_scale_up.json`        | gate_2_campaign  | proposal  | `scale_up`, 20-30% bump, hook + freq rationale                                            |
| 03  | `03_creative_fatigue_add.json`   | gate_2_campaign  | proposal  | `new_creative` × 3-5, **never** `pause_campaign`                                          |
| 04  | `04_insufficient_data_skip.json` | data_sufficiency | skip      | no proposal, rationale cites volume threshold                                             |
| 05  | `05_account_too_young.json`      | human_review     | proposal  | `requires_human_review=true` in payload                                                   |
| 06  | `06_no_benchmark.json`           | human_review     | proposal  | `requires_human_review=true`                                                              |
| 07  | `07_signal_conflict.json`        | human_review     | proposal  | `requires_human_review=true` — gate1 says winner, gate2 says loser                        |
| 08  | `08_multiple_winners.json`       | gate_2_campaign  | proposal  | payload.options has 2-3 alternatives                                                      |
| 09  | `09_big_budget_jump.json`        | human_review     | proposal  | `requires_human_review=true` — explicit operator confirmation needed                      |
| 10  | `10_cpl_spike.json`              | human_review     | proposal  | `requires_human_review=true` + pause-confirmation                                         |
| 11  | `11_tracking_unverified.json`    | guardrail        | rejection | blocked by `verify_tracking_infrastructure`                                               |
| 12  | `12_budget_below_formula.json`   | guardrail        | rejection | blocked by `enforce_budget_formula`                                                       |
| 13  | `13_deprecated_rule_canary.json` | canary           | —         | the agent **must not** emit this reasoning; if it does, a deprecated rule has leaked back |

## Running the harness

```bash
bash scripts/test.sh tests/golden/          # all fixtures
bash scripts/test.sh tests/golden/ -k gate1 # filter by name
```

## What the harness validates today (Phase 0)

1. **Schema** — every fixture parses and has required keys.
2. **Internal consistency** — `expected.proposal.target_id` references match `input.ad.id` / `input.campaign.id`.
3. **Guardrail existence** — every `guardrail_violations` name appears in [guardrails.md](../../campaigner/prompts/guardrails.md).
4. **Deprecated-rule canary** — scans `campaigner/prompts/*.md` to ensure no deprecated §6.7 rule has regressed into the agent's runtime instructions.

**Not yet validated:** actual agent output against the fixtures. That requires `claude -p --dry-run` mode, which lands in Phase 4 per PRD §3.3. Until then these fixtures are a _definition of correctness_ — not an executable gate.

## Phase plan

| Phase       | What lives here                                                   | Harness runs                                                        |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| **0 (now)** | 13 synthetic fixtures, hand-authored from spec                    | Schema + consistency + deprecated canary                            |
| **1-3**     | Same 13 fixtures; operator reviews before Phase 4 signs off       | Same                                                                |
| **4+**      | Real captures replace the synthetic ones as dry-run produces them | Real Claude `--dry-run` replay; assert decision class + tagged gate |

After Phase 4, the developer stops inventing scenarios — real data takes over. The scaffold stays for bootstrapping a new business (spec §15.3 refresh_knowledge onboarding).
