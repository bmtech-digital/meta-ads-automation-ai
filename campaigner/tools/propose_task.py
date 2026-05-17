"""
tools/propose_task.py — insert a row into `approvals` (the HITL queue).

This is the ONLY way Claude can propose an action to a human. The agent
never acts on Meta directly from the observe-propose flow — every change
goes through this table, which is read by `execute_approvals.sh` after a
human (or auto-approval rule) flips `status='approved'`.

Exit codes per contract §11.6 (0 / 1 / 2).
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)

# Per spec §10.4 comment on `task_type`. Two groups:
#   * Ad-management — mutate campaigns/adsets/ads on the ad account.
#   * Organic page publishing — write to a Page or IG account (Phase 3).
VALID_TASK_TYPES = (
    # Ad management
    "budget_change",
    "pause_campaign",
    "resume_campaign",
    "pause_adset",
    "new_creative",
    # Full campaign creation — agent proposes campaign + ad set + ad in a single
    # approval. Payload contract (REVISED 2026-05-13 PM for completeness — guardrail §38
    # `new_campaign_payload_completeness` enforces the minimum):
    #
    #   new_campaign: {
    #     # ─── CAMPAIGN LEVEL (mandatory) ───
    #     campaign_name: str,                # Hebrew, descriptive: "Aiweon-Leads-מנהלי-שיווק-מאי26"
    #     objective: str,                    # OUTCOME_LEADS | OUTCOME_TRAFFIC | OUTCOME_ENGAGEMENT
    #                                        # | OUTCOME_SALES | OUTCOME_AWARENESS | OUTCOME_APP_PROMOTION
    #     special_ad_categories: list[str],  # MANDATORY even if empty (Meta requires explicit declaration).
    #                                        # Valid: HOUSING | EMPLOYMENT | CREDIT |
    #                                        # ISSUES_ELECTIONS_POLITICS | ONLINE_GAMBLING_AND_GAMING.
    #                                        # Default for non-restricted: [].
    #     buying_type: str | None,           # AUCTION (default; agent never proposes RESERVED).
    #     bid_strategy: str | None,          # LOWEST_COST_WITHOUT_CAP (default — Andromeda-friendly)
    #                                        # | LOWEST_COST_WITH_BID_CAP | COST_CAP | LOWEST_COST_WITH_MIN_ROAS.
    #                                        # The agent MUST justify any non-default in the rationale.
    #     spend_cap_ils: number | None,      # Optional safety cap. Recommended: monthly_budget × 0.5 for new campaigns.
    #
    #     # ─── BUDGET (campaign-level CBO; one of these is required) ───
    #     daily_budget_ils: number | null,   # OR lifetime_budget_ils. Cannot specify both.
    #     lifetime_budget_ils: number | null,
    #     start_time_iso: str | None,        # ISO-8601. Default: immediate.
    #     stop_time_iso: str | None,         # ISO-8601. Required if lifetime_budget set.
    #
    #     # ─── AD SET LEVEL (mandatory) ───
    #     adset_name: str,
    #     optimization_goal: str,            # CONVERSIONS | LINK_CLICKS | LANDING_PAGE_VIEWS |
    #                                        # LEAD_GENERATION | OFFSITE_CONVERSIONS | VALUE |
    #                                        # THRUPLAY (for video) | REACH | IMPRESSIONS.
    #                                        # MUST be coherent with `objective` (see §T6 in decision-tree.md).
    #     billing_event: str,                # Almost always IMPRESSIONS in 2026.
    #     promoted_object: {                 # REQUIRED for OUTCOME_LEADS / OUTCOME_SALES / OUTCOME_ENGAGEMENT (messaging).
    #       page_id: str | None,             # Required for MESSAGES, LEAD_GENERATION on-Facebook.
    #       pixel_id: str | None,            # Required for OFFSITE_CONVERSIONS, CONVERSIONS.
    #       custom_event_type: str | None,   # LEAD | PURCHASE | COMPLETE_REGISTRATION | etc.
    #       application_id: str | None,      # For app campaigns.
    #     } | null,
    #
    #     # ─── TARGETING (mandatory; structure follows Meta's targeting spec) ───
    #     targeting: {
    #       geo_locations: {                 # REQUIRED. At minimum, countries=["IL"].
    #         countries: list[str] | None,
    #         regions: list[{key: str}] | None,
    #         cities: list[{key: str, radius: int, distance_unit: str}] | None,
    #         zips: list[{key: str}] | None,
    #       },
    #       age_min: int,                    # REQUIRED. Min 18 in 2026 (Meta hard rule).
    #       age_max: int | None,             # Default 65. In Advantage+ becomes a soft suggestion.
    #       genders: list[int] | None,       # [1]=male, [2]=female, omit=all.
    #       locales: list[int] | None,       # Hebrew is locale 28.
    #       flexible_spec: list[dict] | None,  # AND-of-OR groups for interests/behaviors/demographics.
    #                                          # In 2026, this is a SOFT suggestion under Advantage+ — Meta expands beyond.
    #       custom_audiences: list[{id: str, name: str}] | None,
    #       excluded_custom_audiences: list[{id: str, name: str}] | None,
    #       targeting_automation: {advantage_audience: 0|1},  # 2026 default: 1 (Advantage+ ON).
    #                                                          # Set 0 only with explicit reason in rationale.
    #       publisher_platforms: list[str] | None,             # ["facebook", "instagram"]; default both.
    #       facebook_positions: list[str] | None,              # feed/story/reels/marketplace/etc.
    #       instagram_positions: list[str] | None,             # stream/story/reels/explore/etc.
    #       device_platforms: list[str] | None,                # ["mobile", "desktop"]; default both.
    #     },
    #
    #     # ─── AD LEVEL (mandatory) ───
    #     ad_name: str,
    #     creative_kind: "image" | "video",
    #     creative_source: {                 # ONE of these is required.
    #       image_path: str | None,          # Local path to upload (Imagen output).
    #       creative_gallery_id: uuid | None,  # Existing gallery row (Block 8).
    #       video_path: str | None,          # For creative_kind=video.
    #       existing_post_id: str | None,    # Boost-pattern (rare for new_campaign — usually new_creative path).
    #     },
    #     copy: {                            # The Hebrew customer-facing copy.
    #       headline: str,                   # ≤ 40 chars. Hook in 5 words.
    #       primary_text: str,               # 80-150 chars. Main message.
    #       description: str | None,         # ≤ 30 chars. Sub-headline.
    #       cta: str,                        # Meta enum: LEARN_MORE | SHOP_NOW | SIGN_UP | MESSAGE_PAGE |
    #                                        # CONTACT_US | SUBSCRIBE | DOWNLOAD | APPLY_NOW | etc.
    #       link_url: str,                   # Destination URL.
    #       display_link: str | None,        # Optional cleaner display URL.
    #     },
    #     identity: {                        # Who's posting.
    #       page_id: str,                    # Required.
    #       instagram_actor_id: str | None,  # Required if any instagram_positions targeted.
    #     },
    #     tracking: {                        # Optional but recommended.
    #       url_tags: str | None,            # "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}"
    #       pixel_id: str | None,            # Inherits from promoted_object if set; explicit override allowed.
    #     } | null,
    #
    #     # ─── COLD START / DIAGNOSTIC METADATA (encouraged for §T6) ───
    #     marketing_angle: str | None,       # "social_proof" | "comparison" | "urgency" | "utility" — drives §T_PE pool diversity tracking.
    #     service_tag: str | None,           # From business_knowledge.products[].service_tag — MUST be set for businesses with multi-service offer (Aiweon).
    #     hypothesis: str | None,            # 1-line Hebrew, why this combo will work.
    #   }
    #
    # The agent CANNOT skip required fields with `null` — guardrail §38
    # rejects payloads missing campaign_name, objective, special_ad_categories,
    # daily_budget OR lifetime_budget, adset_name, optimization_goal, billing_event,
    # targeting.geo_locations, targeting.age_min, ad_name, creative_kind,
    # creative_source (≥1 of its sub-fields), copy.headline, copy.primary_text,
    # copy.cta, copy.link_url, identity.page_id.
    #
    # For LEAD or CONVERSIONS objectives, guardrail §38 also requires
    # promoted_object.pixel_id (CONVERSIONS) or promoted_object.page_id (LEAD).
    "new_campaign",
    "scale_up",
    "scale_down",
    "expand_audience",
    # Organic page publishing — every type supports --scheduled-for.
    # Payload contract per type:
    #   publish_fb_post:    {message?, link_url?, image_url?, caption?}
    #     - text-only post: provide `message`.
    #     - photo post:     provide `image_url` (+ optional `caption`).
    #     - link post:      provide `message` + `link_url`.
    #   publish_ig_post:    {image_url | image_urls[], caption}
    #     - single image: `image_url`. carousel: `image_urls` (2..10).
    #   publish_ig_story:   {image_url? | video_url?}  (exactly one)
    #     - no caption — stories don't render text overlays from API.
    #   publish_ig_reel:    {video_url, caption?, thumb_offset_ms?, share_to_feed?}
    "publish_fb_post",
    "publish_ig_post",
    "publish_ig_story",
    "publish_ig_reel",
    # Business-config writes (Phase 3.1). Payload contract:
    #   set_kpi_target: {
    #     kpi: 'cpa'|'cpl'|'roas',
    #     value: number,                          # the agent's recommended target
    #     research: {
    #       market_average: number,
    #       range_low: number,
    #       range_high: number,
    #       currency: 'ILS' (or null for ROAS),
    #       sources: [                            # 2-5 entries — what the agent looked at
    #         {title, url, extracted: 'one-line quote'}
    #       ],
    #       context_used: [str, ...],             # which business_knowledge fields shaped it
    #       researched_at: ISO-8601 timestamp
    #     },
    #     comparison: {                           # null when no live perf yet (cold-start)
    #       current_actual: number | null,
    #       vs_market_pct: number | null,         # (current - market) / market * 100
    #       vs_target_pct: number | null,
    #     },
    #     plan: str                               # "how we get there", Hebrew, 3-5 concrete steps
    #   }
    #   Critical: `research` is NOT optional. The agent must research via
    #   WebSearch — kpi-benchmarks.md is a FALLBACK BAND for sanity-checking
    #   the researched value, not a substitute for actual research.
    #   On approve, web flips businesses.target_<kpi>_<unit>.
    "set_kpi_target",
    # Informational notifications — no Meta call, no DB mutation beyond the
    # approval itself. Used by §T-1 severely_under, §T2+ marginal-return-blocked,
    # §T0r pool_misalignment, etc. The operator approves to acknowledge.
    # Payload contract (REVISED 2026-05-13 — `acknowledgment_only` is now mandatory):
    #   alert: {
    #     alert_type: str,
    #     message: str,
    #     next_steps?: list[str],
    #     acknowledgment_only: bool   # MUST be true on `alert` task_type.
    #                                  # Guardrail §33 `alert_requires_acknowledgment_only_flag`
    #                                  # rejects alerts where this field is missing or false.
    #                                  # The web UI reads this flag to render a "סגור / ראיתי"
    #                                  # button pair instead of "אשר / דחה" — because there is
    #                                  # no Meta call behind an alert, "approve" only acknowledges.
    #                                  # If there IS a real action to take, use the right
    #                                  # task_type (set_kpi_target, publish_*, boost_post, ...)
    #                                  # — NOT alert.
    #   }
    "alert",
    # Boost an existing organic Page post as an ad (object_story_id pattern).
    # Cheaper than `new_creative` from scratch — inherits the post's reactions,
    # comments, and shares as social proof. Added 2026-05-12 (Block 7) per the
    # gallery→campaign-loop gap audit.
    # Payload contract:
    #   boost_post: {
    #     external_post_id: str,          -- from approvals.external_post_id (the published post)
    #     adset_id: str,                  -- existing ad set to attach the boosted ad to
    #     page_id: str | None,            -- override; falls back to business.meta_page_id
    #     daily_budget_ils: number,       -- budget for the boost ad
    #     duration_days: int,             -- documentation only; Meta runs until paused
    #     name: str | None                -- ad name; auto-generated if omitted
    #   }
    "boost_post",
    # Deploy an existing creative_gallery asset into a campaign that doesn't
    # have it. Added 2026-05-13 (Block 8 — gallery-first sourcing). Distinct
    # from boost_post: a redeployed asset is a file (image/video) that has
    # NEVER been a published organic post — it's a gallery row, possibly
    # already in Meta as a creative (we reuse meta_creative_id when present)
    # or possibly still local (we upload + create_creative + create_ad).
    # Use redeploy_creative INSTEAD OF new_creative whenever a viable unused
    # gallery asset exists for the channel — see guardrail §28
    # `prefer_gallery_over_generation`.
    # Payload contract:
    #   redeploy_creative: {
    #     creative_gallery_id: uuid,           -- the gallery row to deploy
    #     adset_id: str,                       -- existing ad set (boost_post pattern)
    #     name: str | None,                    -- ad name; auto-generated if omitted
    #     page_id: str | None,                 -- override; falls back to env.META_PAGE_ID
    #     headline: str | None,                -- override gallery row's headline
    #     primary_text: str | None,            -- override gallery row's primary_text
    #     cta: str | None,                     -- Meta CTA enum; override gallery row's cta
    #     link_url: str | None,                -- override; falls back to gallery row's link
    #     force_reupload: bool,                -- bypass meta_creative_id short-circuit (default false)
    #   }
    "redeploy_creative",
    # A/B test orchestration (Block 11, 2026-05-13). Two task types:
    #
    # ab_test_setup — Declare an A/B test on 2-4 existing creatives in one
    # ad set. Pure DB construct: groups them by `test_name` with a deadline
    # and a winner metric. No Meta call — Meta keeps allocating per Andromeda.
    # Guardrails §29 (min 2 creatives) + §30 (min 7-day window).
    # Payload contract:
    #   ab_test_setup: {
    #     test_name: str,                    -- human label (e.g. "אנגלית-vs-עברית-מאי")
    #     campaign_id: str,                  -- Meta campaign id
    #     adset_id: str,                     -- Meta ad set id (creatives must live in this adset)
    #     winner_metric: 'hook_rate' | 'ctr' | 'cpa' | 'cpl' | 'conversions',
    #     window_days: int,                  -- 7-21 typical (≥ 7 required)
    #     creatives: [                       -- 2-4 entries
    #       {creative_id: str, variant_label: 'A'|'B'|'C'|'D',
    #        creative_gallery_id: uuid|null}
    #     ]
    #   }
    "ab_test_setup",
    # ab_test_decide — Record the test result after the window. Pure DB:
    # writes winner + decision_snapshot. Does NOT pause losers or scale the
    # winner — those follow as normal scale_up / pause_adset proposals if
    # the operator wants. Andromeda discipline: tests inform future creative
    # choices, they don't force allocation moves.
    # Payload contract:
    #   ab_test_decide: {
    #     ab_test_id: uuid,                  -- the test being decided
    #     winner_creative_id: str,           -- pick from the test's creatives
    #     winner_variant_label: str,         -- 'A'|'B'|'C'|'D' for readability
    #     decision_reason: str,              -- Hebrew, plain language
    #     decision_snapshot: {               -- output of evaluate_ab_test
    #       creatives: [...], winner: {...}, confidence: '95pct'|'directional'|'insufficient',
    #       evaluated_at: 'ISO'
    #     },
    #     cancel_instead: bool,              -- if true, status='cancelled' (no winner)
    #   }
    "ab_test_decide",
    # Audience management (Phase 1 — Campaigner Mastery Plan §4.2). Three
    # task_types map to MetaClient.create_custom_audience / create_lookalike.
    # The agent proposes these when the operator's audience pool is thin
    # (no Lookalike off a winning seed, no website-visitor CA, etc.) or when
    # a new_campaign / expand_audience would benefit from a fresh segment.
    #
    # Payload contracts:
    #
    #   create_custom_audience: {                  -- non-PII subtypes only in Phase 1
    #     name: str,                               -- Hebrew-friendly label
    #     subtype: 'WEBSITE' | 'ENGAGEMENT' | 'VIDEO' | 'LEAD_GENERATION',
    #     description: str | null,
    #     retention_days: int,                     -- 1-180 typical
    #     rule: dict | null,                       -- WEBSITE rule per Meta spec
    #     pixel_id: str | null,                    -- optional override for WEBSITE
    #     intended_use: str,                       -- Hebrew: what campaign will consume this
    #   }
    #
    #   create_saved_audience: {
    #     name: str,
    #     description: str | null,
    #     targeting_spec: dict,                    -- Meta targeting spec (geo/age/interests)
    #     intended_use: str,                       -- Hebrew
    #   }
    #
    #   create_lookalike: {
    #     name: str,
    #     origin_audience_id: str,                 -- Meta audience ID of the seed (must exist in meta_audiences)
    #     country: str,                            -- 2-letter (e.g. 'IL')
    #     ratio: float,                            -- 0.01 to 0.10 (1% to 10%)
    #     type: 'similarity' | 'reach' | null,
    #     intended_use: str,                       -- Hebrew
    #   }
    #   Guardrail §29 blocks `create_lookalike` when the seed audience's
    #   approximate_count_upper_bound < 100 (Meta minimum).
    "create_custom_audience",
    "create_saved_audience",
    "create_lookalike",
    # Mastery v2 Phase A (Onboarding Flow F, 2026-05-17). Three task_types used
    # only by the onboarding_chain runner; UI renders them as first-time-flow
    # cards with a "next step" CTA instead of standard approve/reject.
    #
    # fill_business_brief: {step, target_url='/business-knowledge', acknowledgment_only: True}
    #   The agent invites the operator to fill the business brief. No Meta call.
    # audience_brief: {step, target_url='/audiences', prefill_geo, prefill_regions, acknowledgment_only: True}
    #   Confirms geo + asks for exclusions via operator_questions MCQ.
    # first_campaign: {step, target_url='/campaigns/new', service_tag,
    #                  recommended_daily_budget_ils, objective_recommendation,
    #                  audience_summary_he, cold_start_front_load, acknowledgment_only: True}
    #   Complete first-campaign proposal with cold-start front-load math,
    #   benchmark-grounded expectations, and an MCQ asking go/edit-brief/wait.
    "fill_business_brief",
    "audience_brief",
    "first_campaign",
    # Mastery v2 Phase D (Audience Monthly Review, 2026-05-17). Monthly
    # one-per-business proposal summarizing audience health (healthy/decaying/
    # stale/oversized) with up to 2 suggested edits in MCQ format. The
    # operator handles the actual edits via /audiences — agent never edits
    # targeting autonomously per feedback_targeting_owned_by_user.
    # Payload contract:
    #   audience_review: {step, target_url='/audiences',
    #                     summary: {healthy, decaying, stale, oversized}, acknowledgment_only: True}
    "audience_review",
)

VALID_TARGET_KINDS = ("campaign", "adset", "ad", "creative", "account")
VALID_URGENCIES = ("low", "medium", "high", "urgent")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Propose an action for human approval (insert into approvals).",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--run-id", required=True, help="created_by_run_id — links proposal to its invoke"
    )
    p.add_argument("--task-type", required=True, choices=VALID_TASK_TYPES)
    p.add_argument(
        "--payload",
        required=True,
        help='JSON dict with proposal specifics (e.g. {"new_daily_budget_cents":6500,"old":5000})',
    )
    p.add_argument("--rationale", required=True, help="Why this is being proposed")

    p.add_argument("--target-kind", choices=VALID_TARGET_KINDS, default=None)
    p.add_argument(
        "--target-id", default=None, help="Meta object id (required when target-kind is set)"
    )
    p.add_argument(
        "--expected-impact", default=None, help="JSON dict, e.g. {'expected_cpa_change_pct':-12}"
    )
    p.add_argument("--urgency", choices=VALID_URGENCIES, default="medium")
    p.add_argument(
        "--expires-in-hours",
        type=float,
        default=336.0,
        help=(
            "How long this proposal stays 'pending' before auto-expire (default 336h = 14 days). "
            "Was 48h until 2026-05-17, but operators who check the inbox 2-3 times/week were "
            "losing proposals to expiry before they read them."
        ),
    )
    p.add_argument(
        "--scheduled-for",
        default=None,
        help=(
            "ISO-8601 timestamp (with TZ) for when the action should fire. "
            "Honored by execute_approvals — the row stays 'approved' but the "
            "executor skips it until now() >= scheduled_for. Required-in-spirit "
            "for publish_* task types (the agent picks the time, the operator "
            "approves). Omit for ad-mutation types — they fire on approve."
        ),
    )
    p.add_argument(
        "--triggered-plan-id",
        default=None,
        help=(
            "UUID of a plans_carryover row this proposal advances. When set, "
            "after the approval row is inserted the plan is marked 'triggered' "
            "with this approval as the trigger. Use when the agent picks up a "
            "forward step from load_active_plans and proposes the next action. "
            "Per guardrail §39 the rationale must also acknowledge the prior plan."
        ),
    )
    p.add_argument(
        "--operator-questions",
        default=None,
        help=(
            "JSON list of MCQ questions to surface inline with the approval — "
            'shape [{id, prompt_he, options:[{value,label_he}], multi?, required?}]. '
            "Max 2 questions per proposal. Hands the operator an answer UI in "
            "the approvals dashboard instead of forcing reject-with-rationale. "
            "Status pending → answered when the operator submits; agent reads "
            "the response on next run via approvals.operator_response. "
            "Validated by guardrail §46 operator_questions_well_formed."
        ),
    )

    args = p.parse_args()

    # Validation
    if args.target_kind is not None and not args.target_id:
        emit_validation_error("--target-id is required when --target-kind is given")
    if args.expires_in_hours <= 0 or args.expires_in_hours > 24 * 30:
        emit_validation_error(
            f"--expires-in-hours must be in (0, 720] (got {args.expires_in_hours})"
        )

    scheduled_for_dt: datetime | None = None
    if args.scheduled_for:
        try:
            scheduled_for_dt = datetime.fromisoformat(args.scheduled_for.replace("Z", "+00:00"))
        except ValueError as e:
            emit_validation_error(
                f"--scheduled-for must be ISO-8601 with TZ (got {args.scheduled_for!r}): {e}"
            )
            return
        if scheduled_for_dt.tzinfo is None:
            emit_validation_error(
                "--scheduled-for must include a timezone offset (no naive datetimes)"
            )
            return

    payload = parse_json_arg(args.payload, "payload")
    if not isinstance(payload, dict | list):
        emit_validation_error("--payload must be a JSON object or array")

    expected_impact = parse_json_arg(args.expected_impact, "expected-impact")
    if expected_impact is not None and not isinstance(expected_impact, dict | list):
        emit_validation_error("--expected-impact must be a JSON object or array")

    operator_questions = parse_json_arg(args.operator_questions, "operator-questions")
    if operator_questions is not None:
        if not isinstance(operator_questions, list):
            emit_validation_error("--operator-questions must be a JSON list")
        if len(operator_questions) > 2:
            emit_validation_error(
                f"--operator-questions max 2 entries (got {len(operator_questions)})"
            )

    expires_at = datetime.now(UTC) + timedelta(hours=args.expires_in_hours)

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    def _do_insert() -> dict:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO approvals (
                    business_id, created_by_run_id, task_type,
                    target_kind, target_id,
                    payload, rationale, expected_impact,
                    urgency, expires_at, scheduled_for, operator_questions
                )
                VALUES (
                    %s, %s, %s,
                    %s, %s,
                    %s::jsonb, %s, %s::jsonb,
                    %s, %s, %s, %s::jsonb
                )
                RETURNING id, status, created_at, expires_at, scheduled_for
                """,
                (
                    args.business_id,
                    args.run_id,
                    args.task_type,
                    args.target_kind,
                    args.target_id,
                    json.dumps(payload),
                    args.rationale,
                    json.dumps(expected_impact) if expected_impact is not None else None,
                    args.urgency,
                    expires_at,
                    scheduled_for_dt,
                    json.dumps(operator_questions) if operator_questions is not None else None,
                ),
            )
            return cur.fetchone()

    try:
        row = with_db_retry(_do_insert)
    except Exception as e:
        emit_runtime_error(f"approvals insert failed: {e}", exc=e)
        return

    # §39 / Migration 023 — if the agent declared this proposal advances a
    # specific plans_carryover step, mark that step `triggered`. Non-fatal
    # if it fails (the plan stays pending and §39 will fire again next run
    # forcing the agent to address it — fail-safe direction).
    triggered_plan_id = None
    if args.triggered_plan_id:
        try:
            from campaigner.lib import plans as _plans
            from campaigner.lib.db import get_connection as _gc

            with _gc() as conn:
                _plans.mark_triggered(conn, args.triggered_plan_id, str(row["id"]))
                triggered_plan_id = args.triggered_plan_id
        except Exception as exc:  # noqa: BLE001
            import sys as _sys

            print(
                f"plans_carryover mark_triggered failed for {args.triggered_plan_id}: {exc}",
                file=_sys.stderr,
            )

    emit_success(
        {
            "approval_id": str(row["id"]),
            "triggered_plan_id": triggered_plan_id,
            "business_id": args.business_id,
            "task_type": args.task_type,
            "target_kind": args.target_kind,
            "target_id": args.target_id,
            "status": row["status"],
            "urgency": args.urgency,
            "created_at": row["created_at"].isoformat(),
            "expires_at": row["expires_at"].isoformat(),
            "scheduled_for": row["scheduled_for"].isoformat() if row["scheduled_for"] else None,
        }
    )


if __name__ == "__main__":
    main()
