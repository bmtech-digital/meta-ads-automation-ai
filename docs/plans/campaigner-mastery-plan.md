# Campaigner Mastery Plan — Full-Stack Meta Account Management via Approval Flow

> **Status:** Master plan — opened 2026-05-13 by Roi + Claude after the comprehensive scan.
> **Owner:** This document. All phase docs live in `docs/plans/mastery/phase-N-*.md` once opened.
> **Source incident:** The 2026-05-13 scan found that the agent could only touch ~20% of what a competent Meta operator does. This plan closes the rest, phase by phase, with HITL preserved.

---

## 0. Vision

Make the Campaigner a true alternative to Meta Ads Manager UI. Every knob a human turns in Ads Manager — audience creation, campaign setup, lead-form management, account health, reporting — must be **proposeable by the agent**, **inspectable by the operator**, and **executable only after approval**. The agent's edge over the UI: business-knowledge-aware reasoning, KPI reality-check, deterministic guardrails, and a closed feedback loop from lead quality back to audience/creative choice.

### Operating principles (binding for every phase)

1. **HITL preserved.** Mutations to Meta or to business config only via the `approvals` flow. No silent writes.
2. **Lead quality > Meta-internal metrics.** A campaign with cheap CPM/CTR but garbage leads is not a winner. (See §1 — The 16.4 Lesson.)
3. **Approval = atomic intent.** A `new_campaign` proposal carries the full bundle (objective + audience + budget + creative + KPI target) so approval executes one coherent unit.
4. **The agent does not improvise.** A `task_type` without a defined Step 1-7 procedure in `CAMPAIGNER.md` is not run. Adding a knob = adding both the protocol AND the tool AND the guardrail.
5. **Single SDK ownership.** Meta SDK lives only in [`campaigner/lib/meta_client.py`](../../campaigner/lib/meta_client.py). New audiences/forms/etc. extend MetaClient — no new SDK imports elsewhere.
6. **Every phase closes end-to-end before the next opens.** Migration + tools + execute_task branch + guardrail + UI route + agent integration + tests. No half-shipped phases.

---

## 1. The 16.4 Lesson — quality > Meta-internal metrics

> Roi, 2026-05-13: "קמפיין 16.4 היה הכי חזק אבל הלידים לא היו איכותיים."

`קמפיין הודעות מותאם אישית 16.4.2026` showed CTR 2.94%, CPM ₪11, cost per message ₪7 — best-in-account by every Meta-internal signal. Yet Roi paused it because **the conversations it produced didn't lead to qualified business**. The agent today has zero visibility into this. It would have flagged that campaign as a "winner" candidate and proposed scaling.

**Constraint for every future phase:** any "winner" classification (Gate 2 in `performance-brain.md`) must be conditional on operator-attested lead quality when leads exist for the campaign. Scaling proposals on cheap-Meta-metrics with no quality signal must default to "monitor more, do not scale" until quality data lands. This is encoded in **Phase 2** (Lead Quality Feedback Loop) and enforced by **guardrail §31** (`winner_requires_quality_grade`).

---

## 2. Surfaces the Campaigner must cover

This is the exhaustive inventory of what Meta lets you control. Each row maps to one or more phases below. ✅ = already implemented; 🟡 = partial; ❌ = missing.

### Account level

| Surface | Status | Phase |
|---|---|---|
| Pixel ID lookup + status | ✅ | done |
| CAPI configured flag | 🟡 (operator-attested) | Phase 7 |
| Domain verification check | 🟡 (operator-attested, no sub-check) | Phase 7 |
| AEM priority events config | 🟡 (count only) | Phase 7 |
| Spending limits (account-level) | ❌ | Phase 7 |
| Payment method + status | ❌ | Phase 7 |
| Account quality / rejected ads | ❌ | Phase 7 |
| BM-asset inventory (pages, IGs, pixels, audiences) | ❌ | Phase 1 + 7 |
| Billing alerts | ❌ | Phase 7 |

### Audience layer

| Surface | Status | Phase |
|---|---|---|
| Custom Audiences (Website, Customer file, Lead form, IG engager, FB engager, Video viewer, App activity) | ❌ | **Phase 1** |
| Saved Audiences (demos + interests + behaviors) | ❌ | **Phase 1** |
| Lookalike Audiences (1%, 1-5%, 1-10%, country) | ❌ | **Phase 1** |
| Special Ad Audiences (housing/employment/credit/social) | ❌ | Phase 1 (read-only first) |
| Audience overlap analysis | ❌ | Phase 1 |
| Audience size estimates | ❌ | Phase 1 |
| Exclusion audiences (cross-campaign) | ❌ | Phase 1 |
| Page-level audiences (engager etc.) | ❌ | Phase 1 |

### Campaign layer

| Surface | Status | Phase |
|---|---|---|
| Campaign create (objective + special category + buying type) | 🟡 (lib method exists, no proposal flow) | Phase 3 |
| CBO (Campaign Budget Optimization) toggle | ❌ | Phase 3 |
| A/B test setup | 🟡 (proposal scaffold) | Phase 8 |
| Campaign spending limit | ❌ | Phase 3 |
| Campaign-level frequency cap | ❌ | Phase 3 |
| Special features (Advantage+ Shopping, etc.) | ❌ | future |

### Ad set layer

| Surface | Status | Phase |
|---|---|---|
| Conversion location (Website/App/Messenger/WhatsApp/Phone/Lead form) | ❌ | Phase 3 |
| Performance goal (optimization event) | ❌ | Phase 3 |
| Daily budget + schedule (`budget_change` task_type) | ✅ | done |
| Audience by ID (CA/SA/LAL) | ❌ | **Phase 1** |
| Geo + age + gender + interest targeting (generic spec) | ✅ (`expand_audience`) | done |
| Placement controls (Advantage+ vs manual) | ❌ | Phase 3 |
| Bid strategy + cost cap | ❌ | Phase 3 |
| Attribution window | ❌ | Phase 3 |
| Dynamic Creative toggle | ❌ | Phase 3 |

### Ad layer

| Surface | Status | Phase |
|---|---|---|
| Identity (Page + IG account) | 🟡 (env-default only) | Phase 5 |
| Creative selection from gallery | ✅ (`redeploy_creative`) | done |
| Fresh creative gen (Imagen + Hebrew copy) | ✅ (`new_creative`) | done |
| Format: single / carousel / collection / reel | 🟡 (single only) | Phase 5 |
| CTA + destination URL | ✅ | done |
| UTM params | ❌ | Phase 5 |
| Tracking pixel selection per ad | ❌ | Phase 7 |
| Lead form selection | ❌ | Phase 3 (with lead-gen objective) |
| Branded content / paid partnership | ❌ | future |
| Multi-language ads | ❌ | future |

### Lead / conversion layer

| Surface | Status | Phase |
|---|---|---|
| Lead form management (create/edit) | ❌ | Phase 3 |
| Lead form responses ingestion | 🟡 (webhook exists for Trello) | Phase 2 |
| Per-lead quality grade | ❌ | **Phase 2** |
| Lead → CRM export | 🟡 (Trello only) | Phase 2 |
| Quality-adjusted CPL/CPA in reporting | ❌ | **Phase 2** + Phase 8 |
| CAPI event sending from web side | ❌ | Phase 7 |

### Creative gallery layer

| Surface | Status | Phase |
|---|---|---|
| Manual upload to gallery | ✅ | done |
| Imagen generation | ✅ | done |
| **Backfill from live Meta ads** | ❌ | **Phase 4** |
| Aspect ratio → channel match | 🟡 (16:9 unsupported) | Phase 4 |
| Aspect ratio normalizer (re-render to 9:16/4:5/1:1) | ❌ | Phase 4 |
| Business-knowledge drift detector | ❌ | **Phase 4** |
| Performance snapshot per asset | 🟡 (gallery field exists, not populated) | Phase 4 |

### Reporting layer

| Surface | Status | Phase |
|---|---|---|
| Daily insights fetch | ✅ | done |
| Per-creative fatigue | ✅ | done |
| Monthly brief vs spend | ✅ | done |
| Cohort analysis (week-over-week conversions) | ❌ | Phase 8 |
| Attribution model comparison (1d vs 7d, click vs view) | ❌ | Phase 8 |
| Custom breakdowns (placement, device, age, gender, country) | ❌ | Phase 8 |
| Quality-adjusted KPI reporting | ❌ | Phase 2 + Phase 8 |
| Lead form response report | ❌ | Phase 2 |

### Cross-status / portfolio layer

| Surface | Status | Phase |
|---|---|---|
| Active campaign rebalance (§T11) | ✅ | done |
| **Paused vs active audit (§T12)** | ❌ | **Phase 6** (the 16.4 paradox) |
| Resume-campaign proposal with quality check | ❌ | Phase 6 |
| Historical winner archive | ❌ | Phase 6 |

### Operational quality-of-life

| Surface | Status | Phase |
|---|---|---|
| Naming convention validator | ❌ | Phase 9 |
| Templates / drafts | ❌ | Phase 9 |
| Bulk operations | ❌ | Phase 9 |
| Webhook receiver for Meta-side changes | ❌ | Phase 9 |
| Multi-objective KPI per business | ❌ | Phase 5 |

---

## 3. Phase ordering and rationale

| Phase | Title | Why this order | Est. duration |
|---|---|---|---|
| **1** | **Audience Manager** | Roi's explicit ask. Without it every `new_campaign` and `expand_audience` proposal is blind. Foundation for Phase 3 wizard. | 1-2 sessions |
| **2** | **Lead Quality Feedback Loop** | Closes the 16.4 lesson. Without it, audience picks (Phase 1) are blind to whether they actually convert. | 1-2 sessions |
| **3** | **New Campaign Wizard (end-to-end)** | Uses Phase 1 + 2. Now `new_campaign` proposals carry real audiences + KPI realities. | 2 sessions |
| **4** | **Gallery Sync + Creative Drift** | Independent. Eliminates the "Meta ad not in our gallery" blind spot. | 1 session |
| **5** | **Multi-Objective KPI + Ad Identity** | Required for messaging vs leads to be measured separately. Tied to ad identity (Page/IG). | 1 session |
| **6** | **Cross-Status Audit §T12 (paused-quality)** | Uses Phase 2 quality signal to ask "why is this good-on-Meta campaign paused?". | 1 session |
| **7** | **Account Health & Pixel Sub-Checks** | Sub-checkbox enforcement at approve-time + account-level signals (rejected ads, payment). | 1-2 sessions |
| **8** | **Reporting v2 + Cohorts** | Quality-adjusted metrics + attribution comparison + custom breakdowns. | 2 sessions |
| **9** | **Operational QoL** | Naming, templates, bulk, webhooks. | 1 session |

A "session" = one focused working block of a few hours. Each phase is **closed** (migrations + code + tests + UI + agent integration) before the next opens.

---

## 4. Phase 1 detailed scope — Audience Manager

### 4.1. Goals

1. The Campaigner can **list** every CA, SA, and LAL on the ad account, with size + age + source.
2. The Campaigner can **propose** creating new CA / SA / LAL (operator approves, Meta call executes).
3. Every `new_campaign` and `expand_audience` proposal carries an **audience selection** by ID (not just generic targeting JSON).
4. The web UI has an `/audiences` page where Roi can inspect + manually trigger sync.
5. Existing audiences from Meta are visible the moment the page loads — no manual data entry.

### 4.2. Deliverables

#### Schema (Migration 022 — `022_meta_audiences.sql`)

```sql
CREATE TABLE meta_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  meta_audience_id text NOT NULL,                     -- Meta's audience ID
  kind text NOT NULL,                                  -- 'custom' | 'saved' | 'lookalike' | 'special_ad'
  subtype text,                                        -- for custom: 'WEBSITE' | 'CUSTOMER_FILE' | 'LEAD_FORM' | 'IG_ENGAGER' | 'FB_ENGAGER' | 'VIDEO_VIEWERS' | 'APP_ACTIVITY'
  name text NOT NULL,
  description text,
  approximate_count bigint,
  approximate_count_lower_bound bigint,
  approximate_count_upper_bound bigint,
  retention_days integer,
  data_source jsonb,                                   -- raw Meta data_source / subtype payload
  rule jsonb,                                          -- raw Meta rule for WEBSITE/CUSTOMER_FILE
  origin_audience_id text,                             -- for LAL: seed audience
  lookalike_spec jsonb,                                -- ratio, country, type
  operation_status jsonb,                              -- Meta's operation_status (ready/syncing/etc.)
  delivery_status jsonb,
  permission_for_actions jsonb,
  external_event_source text,                          -- pixel_id for website audiences
  time_created timestamptz,                            -- Meta-side creation time
  time_updated timestamptz,
  meta_raw jsonb,                                      -- full Meta export
  synced_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (business_id, meta_audience_id)
);

CREATE INDEX meta_audiences_business_kind ON meta_audiences(business_id, kind) WHERE archived_at IS NULL;
CREATE INDEX meta_audiences_lookup ON meta_audiences(business_id, meta_audience_id);

COMMENT ON TABLE meta_audiences IS 'Mirror of CA/SA/LAL/Special audiences from Meta. Synced by sync_audiences.py daily.';
```

#### `MetaClient` extensions ([`campaigner/lib/meta_client.py`](../../campaigner/lib/meta_client.py))

```python
def list_custom_audiences(self, limit: int = 200) -> list[dict]: ...
def list_saved_audiences(self, limit: int = 200) -> list[dict]: ...
# (Saved Audiences are at the business level on Meta — separate endpoint)
def create_custom_audience(
    self, *,
    name: str,
    subtype: str,
    description: str | None = None,
    retention_days: int = 180,
    customer_file_source: str | None = None,  # for CUSTOMER_FILE
    rule: dict | None = None,                  # for WEBSITE
) -> dict: ...
def create_lookalike_audience(
    self, *,
    name: str,
    origin_audience_id: str,
    country: str = "IL",
    ratio: float = 0.01,         # 1% default; up to 0.10
    type_: str | None = None,    # 'similarity' | 'reach'
) -> dict: ...
def estimate_audience_size(
    self,
    targeting_spec: dict,
    optimization_goal: str = "REACH",
) -> dict: ...
def get_audience_overlap(self, audience_ids: list[str]) -> dict: ...
```

Single-SDK-ownership rule: imports `CustomAudience` (and `LookalikeAudience` if separate in this SDK version) — only here.

#### Tools (`campaigner/tools/`)

| Tool | Mode | Purpose |
|---|---|---|
| `sync_audiences.py` | mutation (Postgres write) | Pulls CA + SA + LAL from Meta → upserts `meta_audiences`. Marks rows not in the latest response as `archived_at`. Idempotent. |
| `list_audiences.py` | read-only | Returns audiences from `meta_audiences` (the local mirror). Filters: `--kind`, `--subtype`, `--include-archived`. |
| `propose_audience.py` | mutation (insert pending approval) | Drafts a `create_custom_audience` / `create_saved_audience` / `create_lookalike` proposal. Hebrew rationale. |

#### New `task_type` values

| task_type | Payload | Execute action |
|---|---|---|
| `create_custom_audience` | `{name, subtype, description, retention_days, rule, customer_file_source}` | Calls `MetaClient.create_custom_audience` → writes Meta audience back to `meta_audiences` |
| `create_saved_audience` | `{name, targeting_spec, description}` | Calls Meta create endpoint, writes to `meta_audiences` |
| `create_lookalike` | `{name, origin_audience_id, country, ratio, type}` | Calls `MetaClient.create_lookalike_audience` → writes to `meta_audiences` |

#### `expand_audience` payload extended

```jsonc
{
  // existing generic-targeting shape STILL ACCEPTED for backwards compat
  "new_targeting": {...},
  // NEW: audience-by-ID selection
  "custom_audience_ids": ["..."],
  "lookalike_audience_ids": ["..."],
  "excluded_audience_ids": ["..."]
}
```

`execute_task` for `expand_audience` merges these into the Meta `targeting.custom_audiences` and `targeting.excluded_custom_audiences` arrays.

#### Guardrails ([`campaigner/tools/check_guardrails.py`](../../campaigner/tools/check_guardrails.py))

| Rule # | Name | Logic |
|---|---|---|
| §29 | `audience_size_min` | A `create_lookalike` proposal whose `origin_audience.approximate_count < 100` is blocked (Meta requires 100+ for LAL). |
| §30 | `audience_targeting_max_specificity` | Block ad set proposals where `custom_audience_ids` AND narrow interest targeting are both applied — Andromeda prefers broad. |

#### Web UI

| Route | Purpose |
|---|---|
| `/audiences` | List view: kind tabs (Custom / Saved / LAL / Special), size + age columns, "סנכרן עכשיו" button |
| `/audiences/[id]` | Detail view: rule definition, source pixel, retention, list of campaigns using it |
| `<AudiencePicker>` component | Reusable: multi-select with size + age + kind chips. Used in `expand_audience` and `new_campaign` approval pages. |

#### Agent integration (CAMPAIGNER.md updates)

- Flow A Step 1: add `python -m campaigner.tools.list_audiences --business-id $BUSINESS_ID` to the signals fetch. Cache for the run.
- `§T_PE` (pool exhausted) lane already considers creatives; extend to also surface audience options when relevant.
- Every `expand_audience` proposal **must** reference at least one audience ID (or explicitly state `targeting_only=true` with operator-facing reason).

### 4.3. Acceptance criteria

1. `python -m campaigner.tools.sync_audiences --business-id <id>` returns count of synced audiences and writes to `meta_audiences`.
2. `python -m campaigner.tools.list_audiences --business-id <id>` returns JSON list with size + kind for every audience.
3. Web `/audiences` renders the list in Hebrew RTL.
4. A test `propose_audience` → approve → `execute_task` cycle creates a new audience in Meta and writes it back to the local mirror with the new `meta_audience_id`.
5. `expand_audience` proposal with `custom_audience_ids: [...]` executes and the ad set targeting reflects it (verified via `fetch_meta_state --object-type adset`).
6. `check_guardrails` returns 25 + 2 = 27 deterministic rules.
7. Contract tests pass.

### 4.4. Out-of-scope for Phase 1 (deferred)

- Customer file PII upload + SHA-256 hashing UI (Phase 2 or 3 — needs lead-data sources first).
- Audience overlap matrix UI visualization.
- Real-time size estimates as the operator builds a saved-audience spec (Phase 3 — wizard work).
- Special Ad Audience creation (regulated category — read-only in Phase 1).

---

## 5. Phase 2 detailed scope — Lead Quality Feedback Loop (preview)

### Goals
1. Every lead from a Meta Lead Form lands in a local `leads` table.
2. Roi can grade each lead 1-5 (or skip).
3. Agent reads grades in Flow A Step 1 → computes quality-adjusted CPL per campaign.
4. Gate 2 "winner" status requires `avg_quality >= 3.5` over last 14 days.
5. Monthly report shows raw CPL + quality-adjusted CPL side-by-side.

### Deliverables (sketch — to be expanded when Phase 2 opens)
- Migration 023: `leads` + `lead_quality_grades` + `businesses.lead_quality_*` summary
- Tools: `ingest_lead_webhook.py`, `grade_lead.py`, `fetch_lead_quality_summary.py`, `compute_quality_adjusted_kpi.py`
- Guardrail §31: `winner_requires_quality_grade`
- Web: `/leads` list + bulk grade UI + per-lead detail
- Webhook receiver: Meta Lead Ads → `webhook/lead_receiver.py` (exists for Trello, extend)

---

## 6. Phase 3 detailed scope — New Campaign Wizard (preview)

### Goals
End-to-end `new_campaign` proposal: objective + audience pick (Phase 1) + budget reality-check + creative selection + KPI target (Phase 5) + approval-time per-objective ad-set count.

### Deliverables (sketch)
- `propose_new_campaign.py` with full bundle
- `execute_task` branch for `new_campaign` that creates campaign + N ad sets + M ads in one transaction (with rollback)
- Guardrail §32: `campaign_objective_aligned_with_kpi`
- Web `/campaigns/new` wizard
- Agent §T_NC lane

---

## 7. Phase 4 detailed scope — Gallery Sync + Creative Drift (preview)

### Goals
1. Every Meta ad on the account has a `creative_gallery` row.
2. Aspect ratios that don't match any channel surface a `redeploy_creative` proposal with `requires_normalization=true`.
3. Drift between ad copy and `business_knowledge.products` is flagged as an `alert`.

### Deliverables (sketch)
- `backfill_gallery_from_meta.py`
- Aspect normalizer (FFmpeg / re-render)
- `check_business_alignment.py` (Claude API semantic compare)
- §T_CR lane

---

## 8. Phase 5 detailed scope — Multi-Objective KPI + Ad Identity (preview)

### Goals
1. A business can hold per-objective KPI targets: `{"OUTCOME_LEADS": {"primary":"cpl","target":150}, "OUTCOME_ENGAGEMENT": {"primary":"cost_per_message","target":15}}`.
2. Ad identity (Page + IG account) is selectable per ad, not env-default.

### Deliverables (sketch)
- Migration 024: `businesses.kpis_per_objective jsonb` + `ad_identity_options` view
- `set_kpi_target` proposal payload extended with `objective` field
- `compute_quality_adjusted_kpi` reads per-objective targets
- Web business-knowledge editor: per-objective rows

---

## 9. Phase 6 detailed scope — Cross-Status Audit §T12 (preview)

### Goals
Surface "paused campaigns that, by Meta-internal metrics + lead quality, were better than the active ones" — but only if the paused campaign's lead quality is verified before the resume proposal.

### Deliverables (sketch)
- `check_cross_status.py` — normalizes per-objective KPIs, compares paused vs active in last 30d
- §T12 lane in decision-tree
- `alert` task_type with `alert_type=paused_campaign_audit` + structured comparison
- Guardrail: `resume_requires_quality_history` — `resume_campaign` proposals must show lead quality from when the campaign was active

---

## 10. Phase 7 detailed scope — Account Health (preview)

### Goals
Beyond pixel: spending limits, payment status, rejected ads, account quality score, page restrictions, BM-asset health.

### Deliverables (sketch)
- `check_account_health.py` (daily)
- Sub-checkbox enforcement at approve-time for `verify_pixel_capi` (operator must tick domain + AEM separately)
- Web dashboard tile: account health summary
- `alert` proposal types: `payment_method_expiring`, `rejected_ads_above_threshold`, `account_quality_dropped`

---

## 11. Phase 8 detailed scope — Reporting v2 (preview)

### Goals
Cohort analysis, attribution comparison (1d vs 7d, click vs view), custom breakdowns, quality-adjusted reports.

### Deliverables (sketch)
- `fetch_cohort_analysis.py`
- `fetch_attribution_comparison.py`
- Custom breakdown UI on `/reports/[month]`
- Quality-adjusted CPL/CPA columns

---

## 12. Phase 9 detailed scope — Operational QoL (preview)

### Goals
Naming conventions, templates, bulk ops, Meta webhook receiver for live-side changes (so backfill #4 isn't on a cron).

### Deliverables (sketch)
- Naming validator (Hebrew-aware)
- Template manager
- Bulk approve/reject in `/approvals`
- Webhook subscription for `ad`, `adset`, `campaign`, `custom_audience` lifecycle events

---

## 13. Phase-1 working order (start here)

Closing this phase means delivering items in this exact order and verifying each before moving to the next:

1. **Migration 022** — `meta_audiences` table.
2. **MetaClient additions** — `list_custom_audiences`, `list_saved_audiences`, `create_custom_audience`, `create_lookalike_audience`, `estimate_audience_size`.
3. **`sync_audiences.py`** — Meta → Postgres mirror, idempotent.
4. **`list_audiences.py`** — Postgres → JSON (read-only).
5. **`propose_audience.py`** — drafts the three new task_types as approvals.
6. **`execute_task.py` branches** — `create_custom_audience`, `create_saved_audience`, `create_lookalike`.
7. **`check_guardrails.py`** — rules §29 + §30.
8. **`expand_audience` payload extension** — `custom_audience_ids`, `lookalike_audience_ids`, `excluded_audience_ids`.
9. **Web `/audiences` page** — list + sync button.
10. **Web `<AudiencePicker>` component** — used by `expand_audience` and (later) `new_campaign` approval pages.
11. **CAMPAIGNER.md updates** — Step 1 includes `list_audiences`; allowed task_types list updated.
12. **Contract tests** — `tests/tools/test_contract.py` rows for the 3 new tools.
13. **End-to-end smoke** — run `sync_audiences` against the live Aiweon account, verify rows appear, render `/audiences`.

Acceptance gate before opening Phase 2: All 13 items above tick. The agent has visibility into existing audiences and can propose creating new ones.

---

## 14. Risk register

| Risk | Mitigation |
|---|---|
| Meta API rate limits during sync (CA list can be large) | Paginate with cursor, cache for 24h, only re-sync on demand or daily cron |
| Customer-file PII handling (Phase 1+) | Defer raw-PII upload to Phase 2 when lead pipeline exists; Phase 1 supports only WEBSITE / ENGAGER / VIDEO_VIEWERS (no PII upload) |
| Lookalike seed pruning by Meta (audiences with <100 people refuse) | Guardrail §29 |
| Approval-flow over-broadening (one big bundle = harder to roll back) | Per-phase: keep granular approvals where possible; `new_campaign` is the only bundled one and gets explicit "rollback plan" payload field |
| Token expiry mid-sync | MetaClient already retries; `sync_audiences` falls back to last-known mirror with `synced_at` timestamp shown in UI |

---

## 15. Update log

| Date | Change |
|---|---|
| 2026-05-13 | Initial draft. Phases 1-9 defined. Phase 1 detailed; Phases 2-9 outlined for context. |
