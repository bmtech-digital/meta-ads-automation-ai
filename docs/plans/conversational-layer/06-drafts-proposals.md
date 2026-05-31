# 06 · Drafts, Proposals & Behavioral Upgrade

> **Conversational Layer PRD** · split 31.5.2026 · [↩ index](README.md) · source §§8.5, 8.6, 9 · **Phase 2 (behavioral upgrade lands P1)**

## 8.5 🧠 Campaign Draft Composer — *Phase 2*
`campaigner/conversation/draft_composer.py` + tool `compose_campaign_draft.py`. Table: `037 campaign_drafts` ([02](02-data-model.md)).
- **Input:** business knowledge · goals · budget · geo · gallery census (`list_active_creatives.py`) · audiences (`list_audiences.py`) · campaign history/outcomes · relevant strategic memory.
- **Output:** `campaign_drafts.structure` jsonb — objective, structure (campaign/ad_sets/ads), targeting (broad + Advantage+), budget split, creative angles, copy directions (Hebrew, obeys `hebrew-copy-style.md`), media selection (gallery vs generate), WhatsApp flow, KPI expectations, risks.
- **⚙️ Hard constraints:** must pass guardrail §38 (payload completeness) + align with [CAMPAIGN_BUILDING_RECOMMENDATIONS.md](../../CAMPAIGN_BUILDING_RECOMMENDATIONS.md); must not reintroduce any §8 deprecated rule.
- **Does NOT publish** — produces a draft → operator reviews ([09](09-frontend.md)) → promote → packaged into existing `approvals` as a `new_campaign` task → normal Flow B.

## 8.6 ⭐ Proposal Lifecycle (add / improve / remove) + Approval Packaging — *Phase 2*
> Operator's ask: *"everything preserved in the proposals layer, and it knows to add / improve / remove, really understanding my need."*

The conversation drives the **existing `approvals` layer** — every change becomes a proposal, traceable, linked to the spawning turn (`related_approval_ids`).

**Lifecycle verbs → existing task types:**
| Operator need | Proposal | Existing task type |
|---|---|---|
| **Add** content/campaign | new campaign / new creative / boost post | `new_campaign` · `new_creative` · `boost_post` |
| **Improve** | scale budget · refresh creative · expand audience | `scale_up` · `redeploy_creative` · audience proposals |
| **Remove**/reduce | pause · scale down | `scale_down` · status change (⚙️ no delete — guardrail) |

**Feedback loop:** operator feedback in chat → `strategic_memory` + `recommendation_ledger` → agent **adjusts** subsequent proposals instead of re-suggesting the rejected thing.

**Approval Context Packaging:** every proposal carries `strategic_reason · expected_outcome · estimated_risk · estimated_lead_impact · estimated_budget_impact · visual_preview_ref · why_now · problem_it_solves` (in `payload.context`, or a small nullable `context jsonb` column). Rendered by `/approvals/[id]` as an "AI campaign proposal", §34-clean Hebrew.

## 9 ⭐ Behavioral upgrade — fixing "generic & passive" (Phase 1 focus)
The agentic layer must change *how it shows up*, not just add a chat box:

1. **Proactively mine existing content.** Each engagement scans gallery + organic posts (via [Creative Intelligence](07-creative-intelligence.md)) and **proposes `boost_post` / `redeploy_creative` when good unused content exists** — instead of defaulting to "generate new" or generic advice.
2. **Drive action, don't report.** Every response ends with a concrete, ranked next step + an action card ([09](09-frontend.md)), not a metric dump.
3. **Specificity over safety.** Translate signals into a decision (*"refresh the creative angle, don't scale budget — attention is fine, emotional connection dropped"*).
4. **Close the feedback loop.** Operator feedback in chat → memory + ledger → adjusted proposals.
5. **One coherent managed plan.** add/improve/remove tracked together in the proposals layer (§8.6), not scattered tips.
6. ⭐ **Add-creative to existing campaign = default fatigue response** (operator's actual tactic). When a creative dies, the brain's **first move is a near-variant added to the same campaign** — *before* scale_down, pause, or duplication. Preserves Learning state, avoids the reset trap. Pause/scale_down only after add-creative attempts fail. (See pattern recognition [05 §C](05-calibration-budget.md).)

> ⚙️ All of the above still passes through the same deterministic guardrails — bolder *communication*, identical *safety*.
