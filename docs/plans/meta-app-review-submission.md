# Meta App Review — Submission Package

> **Status:** Text-ready as of 2026-04-19 (Phase A + B of task 2.2 complete). Submission itself blocked on Phase 1 tooling — video demo requires working CLI.
> **Decision references:** [decisions-log.md §1.3](decisions-log.md#13-meta-app-review--bundle-vs-serial) (bundle strategy) + Phase A decisions 2026-04-19 recorded in §2 and §7 of this doc.
> **Supporting documents:**
>
> - [`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md) — source text for `aiweon.co.il/privacy` (English, required by Meta)
> - [`meta-app-review-privacy-policy-he.md`](meta-app-review-privacy-policy-he.md) — source text for `aiweon.co.il/privacy-he` (Hebrew, for Israeli users)
> - [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md) — source text for `aiweon.co.il/data-deletion` (English)
> - [`meta-app-review-data-deletion-he.md`](meta-app-review-data-deletion-he.md) — source text for `aiweon.co.il/data-deletion-he` (Hebrew)
> - [`meta-app-review-data-usage-summary.md`](meta-app-review-data-usage-summary.md) — one-pager attached to submission
>
> **Language:** Meta App Review is English-only. This document is in English. Hebrew product copy remains in `prompts/` and the web UI.

---

## 1. Submission strategy — Bundled

All six permissions are submitted in a single App Review package with one unified use-case narrative and one video demo that exercises every permission in a continuous flow.

Excluded from this submission: `whatsapp_business_management` (deferred to v2 per CAMPAIGN_EVALUATION §8 — WhatsApp attribution is out of MVP scope).

---

## 2. App-level metadata

| Field                                 | Value                                                                                           | Source / status                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| App name (Meta Developer Portal)      | `Campaigner by Aiweon` — **new app**, not a rename of the inherited one                         | Decided 2026-04-19 Phase A                                                                               |
| Existing Meta App ID (legacy, unused) | `3175000345993024` (inherited from Brazilian fork)                                              | Not used in submission. No rename — reviewers would see fork history.                                    |
| New Meta App ID                       | `[TBD — assigned when Roi creates the new app in developers.facebook.com]`                      | Blocks final submission. Update `.env META_APP_ID` + Secret Manager once assigned.                       |
| Display name in review                | `Campaigner by Aiweon`                                                                          | —                                                                                                        |
| Category                              | Business                                                                                        | —                                                                                                        |
| Platform                              | Web (backend service — no consumer-facing mobile/web client in MVP)                             | —                                                                                                        |
| Business use                          | Internal tooling — managing Aiweon's own Meta ad accounts. Not offered to third parties in MVP. | —                                                                                                        |
| Privacy Policy URL                    | `https://aiweon.co.il/privacy`                                                                  | Text drafted in [`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md). Roi publishes. |
| Terms of Service URL                  | — (skipped; optional for internal apps)                                                         | Decided 2026-04-19 Phase A                                                                               |
| Data Deletion URL or Instructions     | `https://aiweon.co.il/data-deletion`                                                            | Text drafted in [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md). Roi publishes.   |
| App Icon                              | Aiweon logo, 1024×1024 PNG                                                                      | Decided 2026-04-19 Phase A; Roi supplies file.                                                           |
| Primary contact                       | admin@aiweon.co.il                                                                              | —                                                                                                        |

**Note on "internal app" framing:** Meta's App Review process is primarily designed for apps that serve third-party users. Campaigner in MVP serves only Aiweon itself (one business, one ad account). The submission narrative should be explicit about this: **"The app is used internally by Aiweon (an advertising agency in Israel) to manage its own first-party ad campaigns on Facebook and Instagram. There are no external end users in the MVP scope."** This framing is accepted by reviewers as long as it is consistent.

---

## 3. App overview (shared narrative for all 6 permissions)

> Campaigner by Aiweon is an AI-assisted Meta ad management tool used internally by Aiweon, a digital marketing agency based in Israel. The application helps Aiweon's operators evaluate campaign performance, detect creative fatigue, and propose optimizations (budget adjustments, pausing underperforming ads, generating new creatives) for the agency's own Facebook and Instagram advertising accounts.
>
> A core design principle is **Human-in-the-Loop (HITL)**: the automated agent never executes changes on its own. Every action — budget change, pause, creative publish — is written to an approvals queue, where a human operator must explicitly approve it before the application invokes the Meta Marketing API. Every decision, approval, and execution is logged to an audit database (Supabase) for traceability.
>
> The application runs as a scheduled backend service (daily observation cron at 09:00 Israel time; approval-execution cron every 15 minutes). There is no consumer-facing web or mobile surface in the MVP. Access is restricted to Aiweon's internal operator.

---

## 4. Per-permission use cases

Each permission below follows Meta's expected structure: **(a) purpose**, **(b) user-facing flow**, **(c) what data is accessed**, **(d) why the permission is strictly required**, **(e) video demo timestamp**.

### 4.1 `ads_management`

**Purpose.** Create, update, pause, resume, and adjust budgets on Campaigns, Ad Sets, and Ads within Aiweon's own ad account after explicit human approval.

**Flow.** The automated agent analyzes the last 24 hours of campaign insights, generates a proposal (e.g. "Pause ad XYZ — cost-per-result is 2.3× the baseline"), and writes it to the approvals queue. An Aiweon operator reviews the proposal, and clicks "approve." Only then does the application call the Meta Marketing API to apply the change.

**Data accessed.** Write access to ad, ad set, and campaign objects on ad accounts owned by the authenticated user's Business Manager. No data is shared with third parties.

**Why strictly required.** Without `ads_management`, the application can only read data — it cannot apply any of the optimizations an operator approves. The entire purpose of the tool (closing the observe → propose → approve → execute loop) is impossible without it.

**Video timestamp.** 0:30 – 1:00 (approval & execution of a pause action).

---

### 4.2 `ads_read`

**Purpose.** Read ad-level, ad-set-level, and campaign-level performance insights (impressions, clicks, spend, cost-per-result, cost-per-purchase, video hook rate, engagement) for Aiweon's own ad accounts.

**Flow.** A daily cron at 09:00 Israel time fetches the last 24 hours of insights across all active campaigns on the connected ad account. The agent applies a two-gate evaluation model (leading signals such as hook rate and CTR; lagging signals such as cost-per-purchase) and produces observation reports and proposals. A weekly cron additionally reads 7-day trend data to detect creative fatigue.

**Data accessed.** Read-only access to aggregated performance metrics of ads owned by the authenticated user. No user-level personal data is read.

**Why strictly required.** The agent's evaluation loop, fatigue detection, and proposal generation all depend on reading insights. Without `ads_read`, the application is blind.

**Video timestamp.** 0:00 – 0:30 (fetching and displaying daily insights).

---

### 4.3 `business_management`

**Purpose.** Resolve Business-Manager-level context for the ad account being managed: the owning Business, the linked Pages, the linked Pixel, the assigned Ad Accounts.

**Flow.** At the start of each cron invocation, the application calls the Business Manager API to confirm which Ad Account, Page, and Pixel are attached to the configured Business ID. This context is used to validate that the operator's approved action targets the correct asset before the Marketing API call is made (a safety guardrail).

**Data accessed.** Read-only access to the Business Manager's asset list (ad accounts, pages, pixels) owned by the authenticated user.

**Why strictly required.** Campaigner uses a strict guardrail rule: "never operate on an asset that is not explicitly listed under the configured Business." Without `business_management`, the application cannot resolve which assets are legitimate targets, and cannot enforce this guardrail. This matters especially as the app is later extended to manage client accounts (v2).

**Video timestamp.** 1:30 – 2:00 (resolving Business Manager context for the ad account).

---

### 4.4 `pages_show_list`

**Purpose.** List the Facebook Pages connected to the Business, so the application can confirm at startup that the configured `META_PAGE_ID` corresponds to a real, accessible Page under the same Business.

**Flow.** A heartbeat check at the start of every cron invocation lists the Business's Pages and verifies the configured Page is present and accessible. If not, the agent halts and writes a heartbeat alert rather than silently publishing ads attached to the wrong Page.

**Data accessed.** Read-only: the list of Page IDs and names that the authenticated user has access to.

**Why strictly required.** Without this permission, the application cannot validate Page ownership — the risk being that ad creatives are published attached to the wrong Page, damaging brand integrity and causing attribution errors. This is a safety permission, not a feature permission.

**Video timestamp.** 1:30 – 2:00 (Page list verification alongside Business Manager context).

---

### 4.5 `pages_read_engagement`

**Purpose.** Read engagement metrics (reactions, comments, shares, video retention) on organic Page posts that are being promoted as ads, in order to detect creative fatigue.

**Flow.** The weekly creative-firehose cron (Monday 10:00 Israel time) reads engagement trend data for each ad's backing post. When engagement-per-impression drops while cost-per-result rises — the Meta creative-fatigue pattern — the ad is flagged and the agent proposes to generate replacement creative.

**Data accessed.** Read-only engagement aggregates on Page posts that belong to the authenticated user's Page. No user-level comment content or personal identifiers are stored.

**Why strictly required.** Meta's Andromeda delivery system does not guarantee that under-engaging creative is starved quickly enough to avoid waste. The two-gate evaluation model (documented in `CAMPAIGN_EVALUATION.md`) depends on engagement signals to complement the ad-insight signals. Without `pages_read_engagement`, fatigue detection degrades materially and spend is wasted.

**Video timestamp.** 2:00 – 2:30 (engagement trend pulled during fatigue detection).

---

### 4.6 `instagram_basic`

**Purpose.** Verify that the Instagram Professional account linked to the Facebook Page is accessible, so that the ad can be delivered across Advantage+ Placements (Facebook Feed, Instagram Feed, Stories, Reels).

**Flow.** During campaign-creation validation, the application checks whether the Business's Instagram account is linked and has the necessary permissions. If not, the agent falls back to Facebook-only placements and writes a warning — rather than silently losing half the ad inventory.

**Data accessed.** Read-only: Instagram account ID, username, and connection status. No post content, followers, or user-level data.

**Why strictly required.** `CAMPAIGN_BUILDING_RECOMMENDATIONS.md` mandates Advantage+ Placements as the default (Meta's own recommendation in 2026). Advantage+ Placements spans Facebook + Instagram automatically — if the Instagram account is not linked and readable, the ad runs with 30-50% less inventory than intended. This would be a significant regression in ad performance.

**Video timestamp.** 2:00 – 2:30 (Instagram linkage verification and Advantage+ placement preview).

---

## 5. Video demo script (single video, ~3 minutes, covers all 6 permissions)

**Setup.** Record against the dev ad account (`act_202495959` — Roi Halamish personal) with real (but low-spend) test campaigns, so Meta's reviewer sees authentic Meta Marketing API responses. Alternatively, use Meta's test users system if dev account data contains anything sensitive.

**Important.** Campaigner's MVP has no web UI. The video shows (a) CLI output, (b) Supabase approvals table, (c) Meta Ads Manager as visual confirmation. The narrator should verbally state what permission is being exercised in each scene (Meta reviewers appreciate explicit permission callouts).

| Time        | Scene                                                                                                                                                                                                                                           | Permissions exercised                    | Narration (English)                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 – 0:15 | Title card — "Campaigner by Aiweon — Internal Meta Ads Automation Agent".                                                                                                                                                                       | —                                        | "Campaigner is an internal tool Aiweon uses to manage its own Facebook and Instagram ad campaigns. Every agent decision is reviewed and approved by a human operator before execution."                                                                 |
| 0:15 – 0:30 | Operator runs `campaigner fetch` in terminal. CLI outputs a table of campaign metrics.                                                                                                                                                          | `ads_read`                               | "The daily cron uses ads_read to fetch the last 24 hours of performance data — impressions, clicks, cost-per-result."                                                                                                                                   |
| 0:30 – 0:50 | Switch to Supabase web UI showing the `approvals` table with a new row: "Pause ad 123 — CPR 2.3× baseline."                                                                                                                                     | —                                        | "The agent proposes to pause an underperforming ad and writes the proposal to an approvals queue. Nothing executes yet."                                                                                                                                |
| 0:50 – 1:10 | Operator runs `campaigner approve <id>`. CLI confirms "Executed: ad 123 paused." Switch to Meta Ads Manager in a browser — ad 123 shows status Paused.                                                                                          | `ads_management`                         | "The operator approves. The tool uses ads_management to call the Marketing API and pause the ad. The change appears in Meta Ads Manager."                                                                                                               |
| 1:10 – 1:40 | CLI runs `campaigner heartbeat`. Output shows resolved Business Manager context: owning Business ID, connected ad account, list of Pages.                                                                                                       | `business_management`, `pages_show_list` | "On every cron tick, Campaigner uses business_management and pages_show_list to verify the ad account and connected Pages match the configured Business. This is a safety guardrail — the tool will refuse to operate on assets outside this Business." |
| 1:40 – 2:10 | Weekly firehose run. CLI outputs a fatigue report: "Ad 456 — engagement trending down over 7 days, cost-per-result trending up. Flagged for replacement." Show the underlying engagement query.                                                 | `pages_read_engagement`                  | "The weekly creative-fatigue check uses pages_read_engagement to read engagement trends on the Page posts backing each ad. This complements Meta's own Andromeda signals."                                                                              |
| 2:10 – 2:40 | Before publishing a new creative, CLI shows: "Instagram account @aiweon verified, Advantage+ Placements enabled: Facebook Feed, Instagram Feed, Stories, Reels." Show in Ads Manager that the ad preview displays on both FB and IG placements. | `instagram_basic`                        | "Before any ad is created, Campaigner uses instagram_basic to verify the Instagram account is linked. This ensures Advantage+ Placements covers both platforms as Meta recommends."                                                                     |
| 2:40 – 3:00 | Final shot: `agent_decisions` table in Supabase showing an immutable log of every observation, proposal, approval, and execution from the demo.                                                                                                 | —                                        | "Every decision is logged for audit. This is how Aiweon's operator stays in control of the automated tooling. End of demo."                                                                                                                             |

**Recording checklist.**

- [ ] Full-screen, 1080p minimum.
- [ ] Narration in clear English. (Meta reviewers are international.)
- [ ] No personal data on screen — no client campaign names, real customer emails, real ad creative for external clients. Use dev account only.
- [ ] Permission names spoken verbatim when exercised, exactly as they appear in the App Review form.
- [ ] Show the authenticated user (app permissions page or `/me` output) at the start as evidence the session uses the correct Aiweon account.
- [ ] File format: MP4, <100MB (Meta's upload limit).

---

## 6. Supporting documentation attached to submission

Meta will ask for one or more of these during review. Prepare all four in advance:

1. **Privacy Policy** — English draft at [`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md); Hebrew counterpart at [`meta-app-review-privacy-policy-he.md`](meta-app-review-privacy-policy-he.md). Roi publishes both — English at `https://aiweon.co.il/privacy` (the URL Meta sees), Hebrew at `https://aiweon.co.il/privacy-he` (optional best-practice for Israeli users). Describes data collected, why, retention, deletion process; names Meta as a data source.
2. **Data-deletion mechanism** — English draft at [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md); Hebrew at [`meta-app-review-data-deletion-he.md`](meta-app-review-data-deletion-he.md). Roi publishes both. Documented mailto process to admin@aiweon.co.il — acceptable for internal apps.
3. **Data-usage summary** — one-pager at [`meta-app-review-data-usage-summary.md`](meta-app-review-data-usage-summary.md). Attached to submission; maps each permission to fields read, storage, retention, and confirms data does not leave Aiweon's infrastructure.
4. **App-review test credentials** — a Meta test user invited to Aiweon's Business Manager, so the reviewer can sign in and exercise the flows if they choose. Alternatively, clearly state in the submission that the app is internal-only and provide video evidence alone. Many reviewers will accept the latter for internal-business apps; some will push back and request a test flow.

---

## 7. Submission checklist (Task 2.2)

**Text decisions (closed 2026-04-19 Phase A — ✅):**

- [x] App name: `Campaigner by Aiweon` (new app, not rename)
- [x] Privacy Policy approach: published at `https://aiweon.co.il/privacy`, text in [`meta-app-review-privacy-policy.md`](meta-app-review-privacy-policy.md)
- [x] Data Deletion approach: mailto + documented at `https://aiweon.co.il/data-deletion`, text in [`meta-app-review-data-deletion.md`](meta-app-review-data-deletion.md)
- [x] Terms of Service: skipped (optional for internal)
- [x] App Icon: Aiweon logo 1024×1024 PNG (Roi supplies file)

**Roi-owned actions (still pending):**

- [ ] Create new Meta app `Campaigner by Aiweon` in [developers.facebook.com](https://developers.facebook.com). Record new `META_APP_ID` — update `.env` + Secret Manager.
- [ ] Publish Privacy Policy (English) at `https://aiweon.co.il/privacy` + Hebrew at `/privacy-he`.
- [ ] Publish Data Deletion (English) at `https://aiweon.co.il/data-deletion` + Hebrew at `/data-deletion-he`.
- [ ] Prepare Aiweon logo at 1024×1024 PNG for app icon.
- [ ] Dev access token issued for `act_202495959` (Roi Halamish personal) for Phase 1 tool development and video recording.

**Blocked by Phase 1 (cannot proceed until backend tooling exists):**

- [ ] Record the video demo per §5 script. Requires working `campaigner fetch`, `campaigner approve`, `campaigner heartbeat` CLIs.
- [ ] Switch Meta app to **Live Mode**.
- [ ] In Meta Developer Portal → App Review → Permissions and Features: request Advanced Access on all six permissions.
- [ ] Paste §3 narrative into "Overall use of permissions."
- [ ] Paste §4.1-§4.6 per-permission use-cases into justification fields.
- [ ] Attach video to each permission (Meta re-attaches same video per permission).
- [ ] Attach Privacy Policy URL and Data Deletion URL.
- [ ] Submit. Expected turnaround: **2-4 weeks.**
- [ ] If partial rejection: respond inline in same submission thread; do **not** withdraw + resubmit (resets clock).

---

## 8. Known risks in the submission

| Risk                                                                                   | Likelihood                     | Mitigation                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reviewer asks for a test flow they can execute themselves                              | High                           | Provide a test user account attached to Aiweon Business Manager + documented CLI commands the reviewer can run. Pre-populate the ad account with dummy data. |
| "Internal app" framing rejected (reviewer treats Campaigner as a third-party platform) | Medium                         | Respond with explicit statement that Aiweon is sole operator in MVP. Provide Aiweon's business registration (ח.פ) as evidence.                               |
| One permission rejected (typically `pages_read_engagement` — commonly challenged)      | Medium                         | Be ready to strengthen §4.5's fatigue-detection justification. Have 1-2 example queries + expected outputs ready to attach.                                  |
| Video does not show a complete end-to-end flow for all 6 permissions                   | Low (if §5 script is followed) | Rehearse the video run once before recording.                                                                                                                |
| Business Verification in progress but not complete when App Review submitted           | Low                            | App Review and BV are independent tracks at Meta. Submission can proceed. Only System User Token requires BV (v2).                                           |

---

## 9. Cross-references

- [Decision: bundled submission](decisions-log.md#13-meta-app-review--bundle-vs-serial)
- [Conversation map — 1.3](conversation-map.md) (marked ✅)
- [Conversation map — 2.2 submission task](conversation-map.md) (execution uses this document)
- [Spec §15 — Permissions table](campaigner-spec.md)
- [Backend PRD §5 Phase 0 checklist](campaigner-backend-prd.md)
- [CAMPAIGN_EVALUATION.md §8 — WhatsApp deferred to v2](../CAMPAIGN_EVALUATION.md)
