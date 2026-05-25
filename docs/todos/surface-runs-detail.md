# TODO — Surface daily-scan results to the operator

**Status:** done · **Filed:** 2026-05-25 by Roi · **Shipped:** 2026-05-25 · **Severity:** high (operator can't see what the agent observed)
**Routes touched:** `/runs/[run_id]` (already implemented), home page (LastScanCard added), `/runs` (new index), `/approvals/[id]` (cross-link added)

---

## ✅ Resolution (2026-05-25)

Built everything in the "What to build" section below:

- **Adapter:** new `listRunsForBusiness(business_id, {graphName?, limit?})` in [`web/src/lib/db/types.ts`](../../web/src/lib/db/types.ts) + `local-postgres.ts` (single GROUP BY query, counts proposals/skips/rejections/errors/campaigns_touched per `run_id`). Supabase stub throws as usual.
- **Helper:** [`web/src/lib/runs-summary.ts`](../../web/src/lib/runs-summary.ts) — pure `summarizeRun(decisions)` returns gate statuses (budget/tracking/account), per-campaign lanes from `route` diagnoses, counts, and a single `topFinding` (errors first, then scale_up/scale_down/pool/proposal/route). Hebrew labels + tone classes colocated.
- **Home card:** [`web/src/components/last-scan-card.tsx`](../../web/src/components/last-scan-card.tsx) wired into [`web/src/app/page.tsx`](../../web/src/app/page.tsx) between BudgetHealthCard and ApprovalsInbox. Renders relative-time header, gate chips, top finding (color-coded), CTA "פתח את הריצה".
- **Index page:** [`web/src/app/runs/page.tsx`](../../web/src/app/runs/page.tsx) — 50 newest runs, one row per `run_id` with graph label, duration, counts, colored left edge on rows with proposals/errors.
- **Nav:** `/runs` added to `nav.tsx` (desktop pills + mobile sheet) using existing `HistoryIcon`.
- **Cross-link:** "צפה בריצה ↗" on `/approvals/[id]` next to "צפה בקמפיין ↗", linking via `approval.created_by_run_id`.

**Verification:** `pnpm typecheck` clean, all 178 Vitest tests pass, `pnpm build` lists `/runs` + `/runs/[run_id]`. Web container restarted and live.

---

## Original brief (kept for context)

---

## The framing (read this first)

The agent runs `daily_observe_propose` and logs a full diagnostic trail to `agent_decisions` every scan — per-campaign lane assignments, signals, skips with reasons, observations. When the scan produces **0 proposals** (because dedup against an existing alert, or because the tracking gate blocks structural lanes), the operator sees **nothing in the UI** even though the agent did substantial work and has a real story to tell.

The data is there. The renderer is there. The page is there. **The gap is discoverability** — the operator has no idea `/runs/[run_id]` exists.

The deeper design point (debated 2026-05-25): proposals and observations are two different artifacts. Proposals get dedup'd correctly (don't spam the queue). Observations should NOT be dedup'd — they're the answer to "what did you see today?" and should always surface, even when the answer is "I looked, here's what I found, no action because gate X."

---

## Current state of `/runs/[run_id]`

**Implemented at:** `web/src/app/runs/[run_id]/page.tsx`

Already renders:
- Header: graph_name(s), run id, created_at relative Hebrew
- Summary card: decision count, duration, LLM model(s), decision-type distribution bar, guardrail-violation count
- Related approvals card (rows where `related_approval_id IS NOT NULL`)
- Related campaigns card (distinct `campaign_id` touched)
- All decisions card: chronological `agent_decisions` list via `DecisionRow` component, showing decision_type / graph_name+node_name / created_at / latency_ms / confidence / collapsible inputs+outputs JSON

Data fetch: `db.listDecisionsForRun(business.id, runId)` — `web/src/lib/db/local-postgres.ts:760`. 404 if no rows.

**It's good.** Don't rebuild it.

---

## What the scan actually logs (use this to design the entry-point UI)

Per CAMPAIGNER.md §A, each `observe_propose` run writes (concretely verified by reading three real runs on 2026-05-25 for business `9f8f42d9-3f6c-4e2e-bc1a-b60f9ff551f3`):

| node_name | decision_type | what it carries |
|---|---|---|
| `boot` | observation | flow started |
| `state_hash` | observation | input-state fingerprint (for skip-on-no-change) |
| `budget_health` | observation | `pace`, `status` (`no_budget_set` / `under` / `over`), `projected_monthly_spend` |
| `tracking_health` | observation | `status: healthy|partial|unverified|unknown` |
| `account_health` | observation | `health_band: healthy|watch|critical` |
| `route` | diagnosis | per-campaign `lane: scale_up_candidate|scale_down_candidate|creative_pool_exhausted|pool_misalignment|routine_observation|hands_off` |
| `diagnose` | diagnosis | per-campaign `label: winner|solid|loser|fatigued` + signals (CTR, CPL, frequency, fatigue) |
| (various) | proposal | when a tool emits to `approvals` |
| (various) | skip | branch taken, no action; outputs explain why |
| (various) | rejection | guardrail block; `guardrail_violations` array |
| (various) | error | tool failure |

The route page already shows all of this. The entry-point UI needs to summarize it.

---

## What to build

### 1. Home-page "last scan" card (required)

Add a card on `/` (above or near the approvals overview) that shows the most recent `observe_propose` run for the active business:

- "Last scan: 2 hours ago" (relative Hebrew, from `MAX(created_at)` of latest run_id)
- Headline counts: N campaigns observed, N proposals written, N skips
- Top-line gates: budget pace status, tracking status, account band (color-coded chips)
- Top-line problem if any: e.g. "1 objective-mismatch flagged on 23.4 סוכן AI"
- CTA: "פתח את הריצה" → `/runs/[run_id]`

The shape of the summary already exists in the scan's stderr text; this card extracts the same content from `agent_decisions` rows. Don't re-derive — pull the `budget_health` / `tracking_health` / `account_health` / `route` / `diagnose` rows for the latest run_id and format.

Query needed (new adapter method on `web/src/lib/db/local-postgres.ts`):

```sql
-- latestRunForBusiness(business_id, graph_name='observe_propose')
SELECT run_id, MIN(created_at) AS started_at, MAX(created_at) AS ended_at,
       COUNT(*) AS decision_count
FROM agent_decisions
WHERE business_id = $1 AND graph_name = $2
GROUP BY run_id
ORDER BY ended_at DESC
LIMIT 1
```

Then `listDecisionsForRun(business_id, run_id)` already exists for the rest.

### 2. Runs index page (recommended)

`/runs` — list view (paginated, newest first). One row per distinct `run_id`, with the same headline shape as the home card. Lets the operator scroll back through recent scans without going through `/history`.

This is `/approvals` for runs — same UX pattern. Use the approvals index as the template (`web/src/app/approvals/page.tsx`).

### 3. Nav link (required)

Add `/runs` to the main shell nav (`web/src/components/shell.tsx` or wherever the nav lives). Without this, the operator still doesn't know the surface exists.

### 4. Cross-link from `/approvals/[id]` (cheap, nice-to-have)

When viewing a proposal, link "see the run this came from" → `/runs/{approval.run_id}`. The data is already on the approval row (or join via `agent_decisions.related_approval_id`).

---

## What NOT to do

- **Don't touch the dedup logic in the agent.** Run 2 and Run 3 produced 0 proposals because the alert from Run 1 already covered the situation. That's correct.
- **Don't remove the tracking/budget/KPI gates.** Blocking `scale_up` / `new_creative` until `tracking_verified=true` is the safety guarantee — without it the agent could scale a campaign whose conversion numbers are lying.
- **Don't add "observation" as a new task_type in `approvals`.** Observations don't belong in the approvals queue. They belong on `/runs/[run_id]`.
- **Don't rebuild `/runs/[run_id]`.** It works. The job is surfacing it.

---

## Acceptance criteria

1. Operator lands on `/` and immediately sees: when the last scan ran, what it concluded (gate statuses + 1-line top finding), and a link into the detail page.
2. Operator can navigate to `/runs` from the nav and see a list of recent scans without going through `/history`.
3. The existing `/runs/[run_id]` page renders unchanged.
4. Three real scans from 2026-05-25 (run_ids `b2e70a34-…`, `c2455f95-…`, `54d09e9b-…` on business `9f8f42d9-…`) display correctly in the new home card and `/runs` list.

---

## Reference: real data this should surface (from 2026-05-25 scans)

Findings the operator never saw because nothing surfaces them:

- **Run 2** flagged objective-mismatch on `23.4 סוכן AI` (OUTCOME_ENGAGEMENT but appears to be a lead-gen service). 7d CPL $192, CPM +41% w/w.
- **Run 3** classified `הראל | לידים | 18.5.26` as `scale_up_candidate` (CTR +53% w/w, ramped +822% w/w, 14 leads at ~₪14 CPL). Blocked by tracking gate but still a strong signal worth surfacing.
- All three runs flagged `no_budget_set` (₪2,773 MTD, projecting ₪3,740/month).

This is the kind of content the home card should make impossible to miss.
