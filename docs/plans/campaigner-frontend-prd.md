# PRD: Campaigner Frontend (MVP)

> **Status:** Draft v1 (2026-04-16)
> **Scope:** Frontend — thin web UI over Supabase. Approvals queue, agent rationale viewer, business knowledge form.
> **Audience:** The developer picking this up as a handoff. Implement against this PRD; reference the spec + companion backend PRD for contracts.
> **Companion:** [`campaigner-backend-prd.md`](./campaigner-backend-prd.md) — agent, tools, cron, CLI. **The backend ships to Phase 5 before frontend Phase 0 starts** (see §5 rollout).
> **Ground truth:** [`docs/plans/campaigner-spec.md`](./campaigner-spec.md) — the frontend is intentionally underspecified there ("layer דק" / "thin layer"). This PRD specifies what the spec does not.
>
> **Roles:**
> - **Operator** = Roi (product owner, daily approver, stakeholder interface).
> - **Developer** = you (reader of this doc, implementer).

---

## 1. Executive Summary

### Problem Statement

The Campaigner backend ships with a CLI as the primary control plane (spec §9.1: "Terminal First"). But the operator also needs a web surface for three reasons: (a) approving from a phone or a stakeholder laptop without shell access, (b) presenting agent reasoning to Aiweon's marketing team in a form they can read — specifically, exposing the Two-Gates evaluation model ([`CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) §2) and baseline-first rationale (EVALUATION §3) so the reasoning structure is visible, not buried in raw JSON, (c) onboarding and maintaining `business_knowledge` — including the tracking-infrastructure verification fields required by the backend's Day-Zero pre-flight ([`CAMPAIGN_BUILDING_RECOMMENDATIONS.md`](../CAMPAIGN_BUILDING_RECOMMENDATIONS.md) §7) — without editing JSONB in SQL. The CLI covers the first power-user use case, not these three.

### Proposed Solution

A single web app that reads and writes the same Supabase tables the backend writes. No LLM calls, no Meta API calls, no business logic beyond data shaping. Three surfaces:

1. **Approvals queue + detail view** — list pending proposals, drill into the `agent_decisions` chain for "why?", click approve/reject.
2. **Business knowledge form** — structured form + guided questionnaire (spec §15.1, §15.2), writes to `business_knowledge` JSONB.
3. **Decision history** — read-only timeline of past approvals + outcomes + rationales, for stakeholder reporting.

The frontend is a **pure Supabase client**. Auth is Supabase Auth. No backend API layer between the frontend and Postgres — RLS is the authorization boundary.

### Success Criteria

Three tiers. Must hit all to declare MVP done.

**Tier 1 — Pipeline complete (engineering gate):**
- Operator can complete the full approve-path from web: log in → open pending queue → open rationale view → click approve → see status change to `approved` within 1s → confirm execution within 15 min (via next `execute_approvals` cron tick visible as `executed` status).
- 100% functional parity with CLI for approve/reject: anything reachable from `campaigner approve <id>` is reachable from the UI.
- Business knowledge form writes every field in the `business_knowledge` schema (§15.1 structured fields + §15.2 questionnaire JSONB). Round-trip (save → reload) preserves all values.
- Hebrew RTL layout renders correctly on all views (tested in Chrome + Safari mobile).

**Tier 2 — Latency & usability (operational gate):**
- p95 page-load for the approvals queue ≤ 1.5s (cold), ≤ 400ms (warm).
- p95 rationale-drill-in (click approval → full `agent_decisions` chain renders) ≤ 1s.
- Business knowledge first-pass completion ≤ 15 minutes by a non-technical stakeholder with the questionnaire open.
- **No web-vs-CLI usage metric.** Operator picks whichever surface fits the moment (mobile = web, shell = CLI). The frontend succeeds when it's fast and readable, not when it wins a turf war.

**Tier 3 — Security (regression gate):**
- 0 security incidents: zero cases of cross-business data leakage (audited by RLS policy test suite).
- 0 cases of the frontend holding any non-anon Supabase key in shipped JS.
- **Cost is not a gate.** Vercel free tier fits single-operator usage comfortably; no ceiling tracked.
- **Rationale readability is not scored.** If the operator finds a rationale unreadable, the fix is a prompt change on the backend — filed as a prompt iteration, not a metric failure.

---

## 2. User Experience & Functionality

### Personas

| Persona | Role | How they use the frontend |
|---|---|---|
| **Operator (Roi)** | Primary approver | Checks queue 1-2×/day; approves/rejects; occasionally reviews decision history; updates business knowledge when Aiweon changes offerings. |
| **Aiweon marketing stakeholder** | Read-only consumer | Reviews daily digest + rationale history to understand what the agent is doing; does not approve. |
| **Developer (you, the reader)** | Builder + maintainer | Implements the frontend per this PRD. Post-ship: uses the rationale viewer as a debugging UI during prompt iteration — same data as `campaigner inspect`, presented visually. |

### User Stories

**US-F1 — See pending approvals at a glance**
*As operator, I want a dashboard showing all pending approvals sorted by urgency (urgent → high → medium → low → created_at desc), each card showing task_type, target (campaign/adset name), rationale (2-4 sentences, truncated), and expected impact, so I can triage in under 30 seconds.*

**US-F2 — Drill into "why did the agent propose this?"**
*As operator, I want clicking an approval to show the full `agent_decisions` chain — every observation, diagnosis, guardrail check, and the proposal itself — so I can audit reasoning without using the CLI. The view must expose the Two-Gates model visually (CAMPAIGN_EVALUATION §2): decisions tagged `gate_1_creative` render in one section, `gate_2_campaign` in another, and `skip_insufficient_data` gets a muted treatment. A Meta Creative Fatigue flag, when present, renders as a distinct badge — not buried in JSON.*

**US-F2b — "Requires human review" is visually loud**
*As operator, I want proposals carrying `requires_human_review=true` (from CAMPAIGN_EVALUATION §9) to stand out in the queue and the detail view with a clear label naming the trigger (low-baseline, signal conflict, etc.), so I never auto-approve one of these by muscle memory.*

**US-F3 — Approve with one click, reject with one reason**
*As operator, I want an "Approve" button that immediately updates status and an "Reject" flow that requires a short reason (free text, 1-200 chars), so I can process the queue quickly but I can't reject without explaining why (feedback loop for v2 RLHF).*

**US-F5 — Edit business knowledge via structured form**
*As operator, I want a form that mirrors the `business_knowledge` schema (vertical dropdown, product list with add/remove, seasons multi-select, questionnaire as grouped sections) so I can onboard or update Aiweon without hand-writing JSONB.*

**US-F6 — Review decision history**
*As stakeholder, I want a timeline view of the last 30 days of approvals — each entry showing proposal → decision → execution outcome — so I can see what the agent did without reading the database.*

**US-F8 — See urgent items without refreshing**
*As operator, I want the nav badge to update via Supabase Realtime **only for proposals with `urgency='urgent'`** (the "burning money" signal — CPA × 3 from spec §8.2), so I notice immediately without refreshing. Routine pending proposals do not drive realtime updates; they appear on the next navigation/refresh. This keeps the WebSocket connection narrow and the signal meaningful.*

**US-F9 — Mobile-usable approval path (narrow scope)**
*As operator, I want **the queue list, the approval detail view, and the approve/reject buttons** to work on my phone, so I can clear the queue on the go. The business knowledge form, decision history, system status panel, and override-reason modal are explicitly **desktop-tested only** — mobile support for those is a non-goal. This keeps mobile QA focused on the one path that actually matters.*

**US-F10 — System status at a glance**
*As operator, I want a small "system status" panel (in the nav or on the home screen) that tells me, per cron flow: when it last ran, whether the last 3 runs succeeded or failed, and whether it's overdue (expected-next-run passed without a heartbeat). So I can see if the backend is alive without grepping Cloud Logging.*

### Acceptance Criteria (rolled up)

**Approvals queue:**
- [ ] `/approvals/pending` lists rows where `status='pending'` AND `expires_at > now()`.
- [ ] Sort: urgency DESC (urgent > high > medium > low), then `created_at` DESC.
- [ ] **No filters in MVP.** Aiweon has few active campaigns; scanning 3-8 cards directly is faster than filtering. Add filters in a later phase if the queue routinely exceeds ~10 visible items.
- [ ] Card shows: urgency badge, task_type label (Hebrew), target (campaign/adset name resolved), rationale (truncated 140 chars + "עוד"), expected_impact (formatted delta, e.g. "CPA -12%"), created_at (relative, e.g. "לפני שעתיים").
- [ ] Card shows a **baseline indicator** when relevant — e.g. "CPA ₪72 (+44% מול baseline 30 ימים)" — pulled from the diagnosis row's `inputs`. Grounded in CAMPAIGN_EVALUATION §3 (relative-not-absolute).
- [ ] Card shows a **`requires_human_review` label** when set, naming the §9 trigger (e.g. "baseline חלש", "signal conflict", "קפיצת תקציב > 30%").
- [ ] "Approve" and "Reject" buttons on each card (also in the detail view).
- [ ] Pending count badge in nav updates via Supabase Realtime subscription **filtered to `urgency='urgent'` only**. Routine pending proposals appear on next navigation/refresh.

**Approval detail + rationale viewer:**
- [ ] `/approvals/:id` shows full proposal (all `approvals` columns that matter) + the full `agent_decisions` chain for `related_approval_id = :id` ordered by `created_at`.
- [ ] Each decision row displays: `node_name`, `decision_type` (colored badge), `summary`, `rationale`, `inputs` (collapsible JSON), `outputs` (collapsible JSON), timestamp, latency.
- [ ] **Decisions grouped by gate** — one section for `gate_1_creative`, one for `gate_2_campaign`, one for `skip_insufficient_data`, one for account-wide — reflecting CAMPAIGN_EVALUATION §2 + §5. Within each group, chronological.
- [ ] **Meta Creative Fatigue flag** renders as a distinct visual badge when present in a diagnosis's `inputs` or `outputs` (CPR ≥ 2× historical), not buried in raw JSON.
- [ ] **Baseline comparisons** surfaced inline: when a diagnosis includes `baseline_cpa`, `baseline_ctr`, etc. in `inputs`, the UI renders "ערך נוכחי vs baseline X ימים" in human-readable form (CAMPAIGN_EVALUATION §3).
- [ ] If the run that produced the approval had other decisions tagged to the same campaign, show them too (per spec §12.5 SQL).
- [ ] Guardrail violations displayed prominently if any, with each named rule linking to a short description from EVALUATION §8 / CAMPAIGN_BUILDING §10 if it's a deprecated-rule enforcement.
- [ ] **Inline creative preview** for `task_type='new_creative'` proposals: image thumbnails (all aspect ratios), copy text (headline + primary + CTA), marketing angle label — rendered inline on the approval detail page, no separate navigation. Data from `creative_gallery` via `approvals.payload.creative_id`. For other task types: no creative preview. **No standalone creative gallery page in MVP** — deferred to v2.

**Approve / reject actions:**
- [ ] Approve: `UPDATE approvals SET status='approved', approved_at=now(), approved_by=auth.email() WHERE id=:id`.
- [ ] Reject: modal asks for reason (required, 1-200 chars). Updates `status='rejected'`, `rejection_reason=<text>`, `approved_by=auth.email()`.
- [ ] **Approve with override** (for proposals with `payload.guardrail_override_required=true`): primary action on the card is renamed "אשר עם override"; clicking opens a confirmation modal that:
  - Displays the violated guardrail rule name + a short plain-language explanation + a link to the relevant knowledge-doc section (EVALUATION §8 / CAMPAIGN_BUILDING §10 where applicable).
  - Requires a reason field (≥10 chars).
  - On confirm: writes `approvals.approved_by_override={rule, reason, overridden_by=auth.email()}` and sets `status='approved'`.
- [ ] Optimistic UI: status flips immediately; on failure, revert + toast.
- [ ] Disabled after `expires_at` with a tooltip "פג תוקף".

**Dry-run visibility:**
- [ ] `/approvals/dry-run` is a separate route (not in the main queue) that lists rows with `status='dry_run'`. Each card is clearly labelled "DRY RUN — לא לביצוע". No approve/reject actions available — only inspect. Useful during Phase 4 and after every prompt change.

**Business knowledge form:**
- [ ] `/business-knowledge` renders as three sections:
  1. "טופס מובנה" (structured fields per spec §15.1)
  2. "שאלון מונחה" (15-20 questions per spec §15.2, grouped)
  3. **"אימות תשתית מעקב"** (tracking infrastructure verification — CAMPAIGN_BUILDING §7 + Day-Zero checklist). Required because the backend **blocks new-campaign proposals** if these are not all green.
- [ ] Tracking section fields (all required before the operator can mark `tracking_verified=true`):
  - [ ] Meta Pixel ID (text) + "verified firing" checkbox
  - [ ] CAPI configured + deduplicated with Pixel (checkbox)
  - [ ] AEM priority events (ordered list, up to 8)
  - [ ] Domain verification status (checkbox, linked to the verified domain string)
- [ ] Save writes to `business_knowledge` with `last_refreshed_at=now()`.
- [ ] Validation: vertical is one of the enum values; ages are integers 13-80; URLs well-formed; at least one product listed.
- [ ] Unsaved changes warning on navigation.
- [ ] Load existing values on mount (1 business in MVP, `business_id` from env or user selection in v2).

**System status panel:**
- [ ] Top-nav widget shows, per flow (`daily_observe_propose`, `execute_approvals`, `weekly_creative_firehose`): last heartbeat age, last-3-runs outcome (green/green/red style), expected-next-run countdown.
- [ ] Data source: `heartbeats` table (backend spec amendment, migration `007_heartbeats.sql`). No separate `alerts` table — alert state is computed from `heartbeats`.
- [ ] **Alert banner** renders at the top of every authenticated page when any flow has 3 consecutive `phase='error'` heartbeats OR is overdue beyond `expected_duration × 2` without an `end` row. Banner text names the flow + how long it's been failing + a link to the status panel.
- [ ] **Token-expiry warning**: pull `META_ACCESS_TOKEN` expiry from an `agent_decisions` row written by `campaigner rotate-token` (or a dedicated `system_state` row TBD). Show a countdown badge in the status panel; yellow at ≤10 days, red at ≤3 days.

**Decision history:**
- [ ] `/history` shows last 30 days of `approvals` with all statuses (executed, rejected, expired, failed).
- [ ] Each row: date, task_type, target, final status, **gate tag** (`gate_1_creative` / `gate_2_campaign` / `skip` — pulled from the linked diagnosis row), link to full detail.
- [ ] Filter: **by gate only** (so the operator can post-mortem "all Gate 1 kills last week" as a single slice — matches how CAMPAIGN_EVALUATION §7 teaches the model). No campaign or status filter in MVP — sort is sufficient at Aiweon's volume.
- [ ] **CSV export: deferred to Phase 4** (not blocking MVP). Until then, stakeholder reporting = screenshot or copy-paste.

**Auth:**
- [ ] Supabase Auth via magic link. No password.
- [ ] Sessions persist across browser restarts (Supabase default).
- [ ] Logged-out users see only a login screen.

**Hebrew / RTL:**
- [ ] `dir="rtl"` on `<html>` for all Hebrew pages.
- [ ] All strings in Hebrew except task_type codes (stored in English in DB; translated at render).
- [ ] Numbers and ISO dates render LTR inside RTL flow correctly.

**Empty states + errors:**
- [ ] Every list/history view renders a plain Hebrew empty state with a helpful next action — e.g. "אין הצעות ממתינות. הסוכן הבא ירוץ ב-09:00." Not blank, not illustrated. Functional.
- [ ] Every Route Handler mutation renders error states inline (not via alerts/modals) — plain Hebrew message + a retry button where safe.

**Accessibility:**
- [ ] Lighthouse Accessibility score ≥ 95 on every route, enforced in CI.
- [ ] No manual WCAG 2.1 AA audit in MVP — automated Lighthouse is the floor; formal audit is a v2 item.

**Dark mode:** Not in MVP. shadcn supports it trivially; add on operator request.

### Non-Goals (explicitly NOT in frontend MVP)

- **Auto-approval configuration UI** — spec §16, deferred to v2. Backend schema has fields; UI doesn't expose them.
- **Multi-business switcher** — single business (Aiweon) only in MVP.
- **Batch approve (across proposals)** — single-proposal approve is fast enough; CLI has multi-ID for power use.
- **Queue filters** (campaign, urgency, task_type) — sort suffices at Aiweon's volume.
- **Standalone creative gallery page** — inline preview on approval detail only.
- **CSV export in Phases 0-3** — Phase 4 if at all.
- **Real-time Meta metrics dashboard** — no live campaign performance charts. The "decision" is the primary unit, not the metric. v2 can add a metrics view.
- **Agent control** — no "run now" button, no pause-agent button. Operator triggers runs via CLI if needed.
- **Push notifications / email alerts** — realtime badge in-app only, and only for `urgency='urgent'`.
- **User management / roles / permissions** — single-operator in MVP. RLS exists for future, auth is just login/logout.
- **Hebrew translation system** — strings hardcoded in Hebrew; no i18n framework.
- **Offline mode / PWA** — online-only.
- **Dark mode** — shadcn supports it but MVP ships light-only.
- **WCAG 2.1 AA manual audit** — Lighthouse ≥ 95 is the MVP floor.
- **Mobile-optimized form editing, history, status panel** — narrow mobile scope to queue + approve/reject.

---

## 3. AI System Requirements

### Tool Requirements

**None in the frontend itself.** The frontend makes no LLM calls. All AI logic is in the backend agent.

The frontend *presents* AI output:
- `agent_decisions.summary` / `rationale` (rendered as text)
- `approvals.rationale` / `expected_impact` (rendered as structured card)
- `approvals.payload` (rendered per `task_type` template — e.g. budget_change shows old→new)

### Evaluation Strategy

**How we measure output quality and accuracy (for a display-only system):**

**E-F1 — Latency SLOs (automated, continuous)**
Lighthouse / Vercel Analytics run on CI for every PR:
- p95 approvals list load ≤ 1.5s cold / 400ms warm
- p95 rationale detail ≤ 1s
- Lighthouse Accessibility ≥ 95

**E-F2 — RLS policy tests (CI gate)**
Dedicated test suite hits Supabase as (a) unauthenticated, (b) a different business's user (seeded), (c) the correct user. Assert: (a) and (b) get zero rows; (c) gets the expected rows. Run on every migration change.

**E-F3 — No secret leakage (CI gate)**
Regex scan of shipped JS bundle: zero matches for service_role patterns, Meta access token patterns, or Anthropic API key patterns. Fails build if found.

**E-F4 — Ad-hoc rationale feedback (no scheduled scoring)**
If the operator hits a rationale they can't act on from the UI alone, they file it as a prompt iteration against the backend. Frontend is the surface, not the authority — unreadable rationales are a backend fix.

**E-F5 — Approval source (tracked, not measured)**
`approvals.approved_by` captures `email` (web) / `terminal` (CLI) / `auto` (future) for historical visibility. No ratio target — operator uses whichever fits.

---

## 4. Technical Specifications

### Architecture Overview

```
┌──────────────────────────────────────────────┐
│              Browser (operator)              │
│   Next.js 15+ App Router, shadcn/ui, RTL     │
│   @supabase/ssr browser client (anon key)    │
└───────────────┬──────────────────────────────┘
                │ HTTPS
                │ - Supabase Auth
                │ - Route Handlers (app/api/**) — Zod validation,
                │   server-side Supabase client with cookie session
                │ - Supabase Realtime (WS) — direct from browser
                ▼
┌──────────────────────────────────────────────┐
│     Next.js pods on GKE (bemtech cluster)    │
│     Docker multi-stage; k8s/ manifests;      │
│     generic-agent-cluster / campaigner ns    │
│     (pattern inherited from treeliant)       │
└───────────────┬──────────────────────────────┘
                │ anon key (RLS-enforced)
                ▼
┌──────────────────────────────────────────────┐
│                Supabase                      │
│     Postgres with RLS (same DB as backend)   │
└───────────────┬──────────────────────────────┘
                ▲
                │ service_role (bypasses RLS)
                │
┌───────────────┴──────────────────────────────┐
│      Backend (Cloud Run Jobs, separate)      │
│    Writes approvals + agent_decisions        │
│    Deploy target: Cloud Run Jobs,            │
│    not GKE — batch/cron fit                  │
└──────────────────────────────────────────────┘
```

**Why two deploy targets in one repo:** backend is cron-triggered batch work (Cloud Run Jobs is the native GCP abstraction); frontend is a long-lived HTTP service (GKE is where treeliant already proves out the pattern). Shared DB is the only runtime coupling.

**Key property:** frontend and backend share the DB but have no direct coupling. Backend never calls frontend; frontend never calls backend; contract is the schema.

### Stack — inherited from `treeliant-dashboard` where applicable

The sibling project `~/projects/treeliant-dashboard` already deploys a Next.js app to the bemtech GKE cluster. We inherit its deployment + repo + data-layer patterns; we diverge on component library and Hebrew/RTL because treeliant is English/Italian only.

| Concern | Decision | Source |
|---|---|---|
| Framework | **Next.js 15+ App Router**, TypeScript | Inherit |
| Data — reads | **React Server Components** fetching via server-side Supabase client | Extend |
| Data — mutations | **Route Handlers** (`app/api/**`) with **Zod** validation; no Server Actions | Inherit (treeliant pattern) |
| Component library | **shadcn/ui** (copy-paste Radix + Tailwind) | **Diverge** — treeliant uses MUI v7; shadcn is a cleaner fit for RTL + a small app |
| Styling | **Tailwind CSS** + custom theme; no CSS-in-JS | Partial inherit |
| Forms | **Native HTML forms + Zod** (shared schemas: client inline validation + Route Handler server-side parse) | Inherit |
| State | **React Context** for auth/theme; no Zustand, no TanStack Query | Inherit |
| Auth | **Supabase Auth** — magic link primary + password fallback | Diverge (treeliant has custom JWT; Supabase Auth is the right fit here since Supabase is the DB) |
| Supabase SDK | `@supabase/ssr` (server cookie client + browser client) | New |
| Realtime | Supabase Realtime subscription for pending-queue badge | New |
| RTL / Hebrew | `dir="rtl"` on root; **Tailwind `rtl:` variants**; **Heebo font via `next/font`**; English labels only where treeliant already has the pattern for font loading | Extended |
| i18n | Not needed MVP (Hebrew-only); skip `next-intl` | Diverge |
| Testing | **Playwright E2E** (login → approve, RLS policy tests) + **Vitest** unit | Diverge (treeliant uses Jest only; Playwright adds RLS + auth E2E coverage) |
| Deploy | **Docker multi-stage → GKE `generic-agent-cluster` on `bemtech-478413`** | Inherit verbatim |
| Registry | `us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo` | Inherit |
| Namespace | Dedicated `campaigner` namespace (not shared with `generic-agent`) | New — cleaner isolation |

**Explicit non-goals for MVP:** Vercel deploy, Server Actions, React Hook Form, Zustand, MUI, `next-intl`, Italian support, Socket.IO (backend is async-via-DB), LangChain in the frontend, custom JWT auth.

### Integration Points

| System | Auth | Access pattern |
|---|---|---|
| Supabase Auth | Magic link via email (primary) + **password fallback** (secondary) | `supabase.auth.signInWithOtp({ email })`; `supabase.auth.signInWithPassword({ email, password })` if magic link email doesn't arrive. Password set during first-time setup by operator. Only the operator has an account in MVP. |
| Supabase Postgres (reads, RSC) | Anon key + RLS | Server-side `createServerClient` (`@supabase/ssr`) in Server Components; cookie-based session passed through |
| Supabase Postgres (mutations) | Anon key + RLS | Via Route Handlers (`app/api/approvals/[id]/approve/route.ts` etc.); Zod-validated input → Supabase client with the caller's cookie session |
| Supabase Realtime | Anon key | Browser-side subscription from a Client Component; filtered by `business_id + status='pending'` |
| Supabase Storage (creative preview — Phase 4 if in scope) | Anon key + RLS | Signed URLs for creative images |

### Data Access — RLS-First

All queries go through RLS. The anon key is the only Supabase credential in the browser. Policies (rough draft — refine pre-ship):

```sql
-- Approvals: users see approvals for businesses they have access to
create policy "users read own business approvals" on approvals
  for select using (
    business_id in (
      select business_id from user_business_access where user_id = auth.uid()
    )
  );

create policy "users update own business approvals" on approvals
  for update using (
    business_id in (
      select business_id from user_business_access where user_id = auth.uid()
    )
  ) with check (
    -- only allow status transitions from 'pending' to 'approved' or 'rejected'
    status in ('approved', 'rejected')
    and (select status from approvals where id = approvals.id) = 'pending'
  );

-- agent_decisions: read-only via UI
create policy "users read own business decisions" on agent_decisions
  for select using (
    business_id in (
      select business_id from user_business_access where user_id = auth.uid()
    )
  );
```

A `user_business_access(user_id, business_id)` table is added for this (single row in MVP: operator → Aiweon).

### Security & Privacy

- **No service_role key in frontend.** Ever. CI check enforces this.
- **RLS is the only authorization.** No server-side auth middleware — Supabase PostgREST enforces policies directly.
- **Magic link auth** avoids password storage; operator-only access in MVP means no user registration flow.
- **CSP header** set via Next.js middleware or the GKE ingress (nginx-ingress `add-headers` annotation) to prevent XSS injecting data-exfil scripts.
- **Sensitive rationale text** may contain Meta ad account IDs, budget numbers, competitor names from business knowledge. These are not PII but should not be shared outside the operator's session — ensured by RLS + auth.
- **Realtime subscriptions** scoped to the user's business_id via RLS filter.

### Performance

- Approvals list: paginated server-side (LIMIT 50, OFFSET). Expected volume ~3-8 pending/day per spec §8.3.
- Agent decisions detail: typically 10-30 rows per approval. No pagination needed.
- Business knowledge form: single row load/save. No performance concern.
- Realtime: single subscription per session, filtered by `business_id + status='pending'`.

---

## 5. Risks & Roadmap

### Phased Rollout

Phases are ordered, not date-bound. Advance a phase only when its exit criteria hold.

**Prerequisite:** Backend has reached **Phase 5 (Observe-only live)** — there are real `approvals` + `agent_decisions` rows to read. The frontend has nothing meaningful to display before that; scaffolding earlier risks building against fake fixtures that don't match production shape.

**Phase 0 — Scaffold + deploy pipeline**
- `create-next-app` with App Router + TypeScript + Tailwind; place under `web/` in the backend monorepo (sibling of `campaigner/`).
- Install shadcn/ui + a starter set of components (Button, Card, Dialog, Form, Badge, Input, Textarea, Tabs).
- `@supabase/ssr` server client + browser client; auth middleware (`middleware.ts`) that redirects unauthenticated requests to `/login`.
- RTL baseline: `dir="rtl"` on root `<html>`, Heebo loaded via `next/font/google`, Tailwind config updated to respect `rtl:` variants.
- **Inherit treeliant's deploy pipeline:** copy `Dockerfile.k8s` + `k8s/overlays/` pattern, adjust for this app. Target: `generic-agent-cluster` in `bemtech-478413`, dedicated `campaigner` namespace. Registry: `us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner-web`.
- Playwright installed; first E2E test: unauthenticated → redirected to `/login`.
- Vitest installed; first unit test: a Zod schema validator.
- RLS policy test harness (three-user setup: unauthenticated, wrong-business, correct-operator).

**Exit criterion:** login works end-to-end against a staging Supabase project; an authenticated page reads one row from `businesses`; a Docker image builds locally; a `kustomize build` against the manifests renders cleanly.

**Phase 1 — Read-only approvals + rationale**
`/approvals/pending` list + `/approvals/:id` detail with full `agent_decisions` chain. No actions yet. Operator can view what the agent is doing. Accelerates backend Phase 5 operator audit. **Exit criterion:** operator uses the UI (not CLI) to audit a full day's proposals.

**Phase 2 — Approve / reject**
Buttons wired to Supabase UPDATE. RLS policies enforced. Optimistic UI. Rejection-reason modal. **Exit criterion:** operator approves + rejects real proposals end-to-end for 3 consecutive days without falling back to CLI for the approval action itself (CLI still fine for `inspect`).

**Phase 3 — Business knowledge form**
Full structured form + questionnaire. Enables operator to update Aiweon knowledge from web instead of SQL/YAML. **Exit criterion:** operator completes a full edit + save + reload round-trip without touching the DB.

**Phase 4 — History + filters + polish**
Decision history timeline, campaign filter, batch approve, CSV export, Realtime pending badge. **Exit criterion:** Tier 2 latency targets hit; queue ergonomics good enough that triage feels instant.

**Phase 5 — v2 triggers**
Auto-approval config UI, multi-business switcher, creative upload, agent control, metrics dashboard — all deferred until signal demands them.

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stack choice fits poorly for RTL or Supabase | Low | Rework in week 1 | Validate with a spike before committing |
| RLS policy misconfiguration leaks data | Medium | Data exposure | E-F3 test suite; manual pentest before Phase 2 ships |
| Magic link email delivery flaky | Low | Operator can't log in | Fallback: Supabase password auth as backup (not default) |
| Stakeholder can't read Hebrew rationale (phrasing, not rendering) | Medium | UI adopted but distrusted | Addressed by backend E3 sampling; frontend surfaces the problem |
| Mobile RTL rendering bugs in Safari | Medium | Operator can't approve on phone | Manual mobile test per PR; Playwright E2E on mobile viewport |
| Supabase free tier limits exceeded | Low | Hosting cost spike | Current row volume projections well under limits; monitor at 30d |
| Browser cache serves stale approval status | Low | Operator approves already-approved item | `Cache-Control: no-store` on approvals data; optimistic UI + server confirmation |
| Anon key leaks and attacker spams magic links | Low | DoS email / operator inbox | Supabase built-in rate limiting; monitoring |

### Open Questions

1. **Language** — Hebrew-only in MVP. Revisit if English-speaking stakeholder joins.
2. **`user_business_access` seeding** — For MVP single-operator, a manual insert at project setup is fine. v2 needs an admin onboarding flow.
3. **Offline / reconnect behavior** — Supabase client handles reconnect automatically; explicit "offline" banner not needed in MVP.

**Resolved post-drafting (for traceability):**
- *CI pipeline:* GitHub Actions on merge to `main` — build Docker image → push to `us-central1-docker.pkg.dev/bemtech-478413/generic-agent-repo/campaigner-web` → `kubectl apply` against `generic-agent-cluster` in the `campaigner` namespace. Fully automated.
- *Staging Supabase:* Single Supabase project with `public` (prod) and `staging` schemas. Migrations apply to both; mechanism confirmed in Phase 1 (see backend PRD flagged item #3).
- *Framework, components, forms, state, auth, RTL, testing, deploy target:* all resolved — see §4 stack table.

### Documentation deliverables

- Brief `web/README.md` with setup + local dev instructions
- Shared architectural docs live in the backend PRD + `docs/onboarding-new-business.md` (for v2 readiness)
- This PRD stays canonical through Phase 4

---

## Sources

- Spec (backend contracts we consume): [`docs/plans/campaigner-spec.md`](./campaigner-spec.md) §10 schema, §12 agent_decisions usage, §15 business knowledge schema.
- Evaluation philosophy: [`docs/CAMPAIGN_EVALUATION.md`](../CAMPAIGN_EVALUATION.md) — the rationale text the UI displays is grounded here.
- Backend PRD: [`docs/plans/campaigner-backend-prd.md`](./campaigner-backend-prd.md) — defines the writer of everything this app reads.
- Supabase docs: Auth, RLS, Realtime, PostgREST.
