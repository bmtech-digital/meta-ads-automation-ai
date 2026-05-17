"""
tools/check_guardrails.py — deterministic check of a proposal against §14 guardrails.

# noqa: this file intentionally imports `re` at module top for §§32-34 added 2026-05-13.

Reads the proposal JSON + optional state JSON, runs every applicable guardrail,
returns structured pass/fail per rule. Claude calls this BEFORE writing the
proposal to approvals — if any guardrail fails, Claude logs a rejection and
skips the propose_task call.

The guardrails here are the ones the agent can check deterministically. Some
§14 rules (e.g. `no_competitor_hallucinations`) require judgment and are
enforced by prompts only — they are listed in `JUDGMENT_ONLY_RULES` and noted
as such in the output.

Contract: §11.6 (JSON stdout, exit 0/1/2).

State fields the checks consume (all optional):
  learning_status : 'LEARNING' | 'LEARNING_LIMITED' | 'ACTIVE'
  hook_rate       : float 0..1
  frequency       : float
  cpa_ils / cpr_ils / baseline_cpa_ils : numeric
  target_cpa_ils  : numeric
  last_conversion_hours_ago : float
  creative        : {"width": int, "height": int, "kind": "image|video|copy"}
  meta_creative_fatigue_flag : bool
  tracking_verified : bool

  -- Block 5 (2026-05-12) additions —
  utilization_7d              : float 0..∞ (spend_7d / (daily_budget × 7))
                                 §19 no_new_creative_when_underspending
  marginal_return_passed      : bool — output of check_marginal_return.passes_guard
                                 §21 marginal_return_check_before_scale_up
  hands_off_campaign_ids      : [str]  — from monthly_brief.hands_off_campaign_ids
  hands_off_brief_is_current  : bool   — monthly_brief_summary.is_current_month
  campaign_id                 : str    — the campaign being targeted by the proposal
                                 §25 respect_hands_off

  -- Block 6 (2026-05-12) M1 Tracking Health Gate —
  tracking_health_status      : 'healthy' | 'partial' | 'unverified' | 'unknown'
                                 — output of check_tracking_health.status; preferred
                                 input to §17 over the raw tracking_verified flag.

  -- Block 8 (2026-05-13) gallery-first sourcing —
  channel                     : 'feed' | 'stories' | 'reels' | None
                                 — which channel the new_creative payload targets.
                                 Used by §28 to query the unused-gallery census
                                 with the right --matches-channel filter.
"""

from __future__ import annotations

import argparse
import re
from collections.abc import Callable
from typing import Any

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)

# ----------------------------------------------------------------- results


def _pass(name: str, **kw) -> dict:
    return {"name": name, "passed": True, **kw}


def _fail(name: str, reason: str, **kw) -> dict:
    return {"name": name, "passed": False, "reason": reason, **kw}


def _skip(name: str, reason: str) -> dict:
    return {"name": name, "passed": True, "skipped": True, "reason": reason}


# -------------------------------------------------------- guardrail checks


def _no_delete_campaigns(prop: dict, state: dict, ctx: dict) -> dict:
    task = prop.get("task_type", "")
    if task.startswith("delete_"):
        return _fail("no_delete_campaigns", "pause is the only supported teardown path")
    return _pass("no_delete_campaigns")


def _max_tasks_per_day(prop: dict, state: dict, ctx: dict) -> dict:
    cap = ctx.get("daily_task_cap")
    if cap is None:
        return _skip(
            "max_tasks_per_day", "daily_task_cap not provided in context — checked by caller"
        )
    count = ctx.get("pending_today_count", 0)
    if count >= cap:
        return _fail(
            "max_tasks_per_day",
            f"daily proposal cap {cap} reached (count={count})",
            cap=cap,
            count=count,
        )
    return _pass("max_tasks_per_day", cap=cap, count=count)


def _no_learning_phase_touch(prop: dict, state: dict, ctx: dict) -> dict:
    ls = state.get("learning_status")
    if ls != "LEARNING":
        return _pass("no_learning_phase_touch", learning_status=ls)
    # Exception: scale_up to minimum budget is allowed.
    if prop.get("task_type") == "scale_up":
        return _pass("no_learning_phase_touch", note="scale_up exception — allowed in LEARNING")
    return _fail(
        "no_learning_phase_touch",
        f"campaign in LEARNING — task_type={prop.get('task_type')} forbidden",
    )


def _budget_jump_max_30pct(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("budget_change", "scale_up", "scale_down"):
        return _pass("budget_jump_max_30pct", note="not a budget-changing task_type")
    pay = prop.get("payload") or {}
    old = pay.get("old_daily_budget_cents") or pay.get("old_daily_budget_ils")
    new = pay.get("new_daily_budget_cents") or pay.get("new_daily_budget_ils")
    if old is None or new is None or old == 0:
        return _skip(
            "budget_jump_max_30pct", "old/new daily budget not in payload — cannot compute delta"
        )
    delta_pct = abs(new - old) / old
    if delta_pct <= 0.20:
        return _pass("budget_jump_max_30pct", delta_pct=round(delta_pct * 100, 2))
    if delta_pct <= 0.30:
        hook = state.get("hook_rate", 0) or 0
        freq = state.get("frequency", 99) or 99
        if hook > 0.35 and freq < 2.0 and state.get("learning_status") == "ACTIVE":
            return _pass(
                "budget_jump_max_30pct",
                delta_pct=round(delta_pct * 100, 2),
                note="20-30% tier unlocked by hook>35% + freq<2.0",
            )
        return _fail(
            "budget_jump_max_30pct",
            f"delta {round(delta_pct * 100, 1)}% requires hook>35% + freq<2.0 + ACTIVE",
            delta_pct=round(delta_pct * 100, 2),
        )
    return _fail(
        "budget_jump_max_30pct",
        f"delta {round(delta_pct * 100, 1)}% > 30% cap",
        delta_pct=round(delta_pct * 100, 2),
    )


def _no_audience_change_on_active(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") != "expand_audience":
        return _pass("no_audience_change_on_active")
    if state.get("learning_status") == "ACTIVE":
        cpa = state.get("cpa_ils")
        target = state.get("target_cpa_ils")
        if cpa is not None and target is not None and cpa <= target:
            return _fail(
                "no_audience_change_on_active",
                "campaign is ACTIVE and meeting target — don't disturb a working audience",
            )
    return _pass("no_audience_change_on_active")


def _no_horizontal_scaling_by_duplication(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") != "new_campaign":
        return _pass("no_horizontal_scaling_by_duplication")
    pay = prop.get("payload") or {}
    if pay.get("duplicate_of_campaign_id") or pay.get("is_duplicate"):
        return _fail(
            "no_horizontal_scaling_by_duplication",
            "duplicating an existing campaign resets Learning — use scale_up on the original",
        )
    return _pass("no_horizontal_scaling_by_duplication")


def _no_pause_on_recent_conversion_24h(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("pause_campaign", "pause_adset"):
        return _pass("no_pause_on_recent_conversion_24h")
    # Emergency override: CPA > 3× target bypasses this rule.
    cpa = state.get("cpa_ils") or 0
    target = state.get("target_cpa_ils") or 0
    if target > 0 and cpa >= target * 3:
        return _pass("no_pause_on_recent_conversion_24h", note="emergency CPA>3× override")
    hrs = state.get("last_conversion_hours_ago")
    if hrs is None:
        return _skip("no_pause_on_recent_conversion_24h", "last_conversion_hours_ago not in state")
    if hrs < 24:
        return _fail(
            "no_pause_on_recent_conversion_24h",
            f"last conversion was {hrs}h ago — campaign still producing results",
        )
    return _pass("no_pause_on_recent_conversion_24h")


def _no_low_res_creative(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("new_creative", "new_campaign"):
        return _pass("no_low_res_creative")
    creative = state.get("creative") or prop.get("payload", {}).get("creative")
    if not creative:
        return _skip("no_low_res_creative", "no creative dimensions in state or payload")
    w, h = int(creative.get("width", 0)), int(creative.get("height", 0))
    if w < 1080 or h < 1080:
        return _fail("no_low_res_creative", f"dimensions {w}x{h} below 1080p minimum")
    return _pass("no_low_res_creative", dimensions=f"{w}x{h}")


def _prefer_add_creative_over_pause(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("pause_campaign", "pause_adset"):
        return _pass("prefer_add_creative_over_pause")
    if state.get("meta_creative_fatigue_flag"):
        return _fail(
            "prefer_add_creative_over_pause",
            "Creative Fatigue flag is on — propose new_creative × 3-5 instead of pause",
        )
    return _pass("prefer_add_creative_over_pause")


def _no_frequency_only_kill(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("pause_campaign", "pause_adset"):
        return _pass("no_frequency_only_kill")
    rationale = (prop.get("rationale") or "").lower()
    mentions_freq = "frequency" in rationale or "freq" in rationale
    mentions_other = any(kw in rationale for kw in ("cpr", "cpa", "fatigue", "hook rate", "ctr"))
    if mentions_freq and not mentions_other:
        return _fail(
            "no_frequency_only_kill",
            "rationale cites Frequency without a confirming signal (CPR / CPA / Fatigue / hook / CTR)",
        )
    return _pass("no_frequency_only_kill")


def _verify_tracking_infrastructure(prop: dict, state: dict, ctx: dict) -> dict:
    """§17. Block scale-spend proposals when Pixel/CAPI is unverified.

    2026-05-12 (M1 Tracking Health Gate): extended the blocked-task list
    from `new_campaign` only to the full scale-spend set. Burning budget on
    an untracked campaign is the same waste regardless of whether it's new
    or scaled.
    """
    BLOCKED = {"new_campaign", "scale_up", "new_creative", "expand_audience"}
    if prop.get("task_type") not in BLOCKED:
        return _pass("verify_tracking_infrastructure")
    # Prefer the high-level `tracking_health_status` from check_tracking_health
    # when available — it's the M1 single source of truth. Fall back to the
    # raw `tracking_verified` flag if the agent only loaded business_knowledge.
    status = state.get("tracking_health_status")
    if status:
        if status == "healthy":
            return _pass(
                "verify_tracking_infrastructure",
                tracking_health_status=status,
            )
        return _fail(
            "verify_tracking_infrastructure",
            f"tracking_health_status='{status}'; {prop.get('task_type')} blocked until operator runs verify_pixel_capi",
            tracking_health_status=status,
        )
    verified = state.get("tracking_verified")
    if verified is False:
        return _fail(
            "verify_tracking_infrastructure",
            f"Pixel + CAPI not verified; {prop.get('task_type')} without tracking burns budget on unmeasured conversions",
        )
    if verified is None:
        return _skip(
            "verify_tracking_infrastructure",
            "neither tracking_health_status nor tracking_verified provided in state — caller must run check_tracking_health first",
        )
    return _pass("verify_tracking_infrastructure")


def _enforce_budget_formula(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("new_campaign", "scale_up"):
        return _pass("enforce_budget_formula")
    pay = prop.get("payload") or {}
    daily = pay.get("daily_budget_ils") or pay.get("new_daily_budget_ils")
    target_cpa = pay.get("target_cpa_ils") or state.get("target_cpa_ils")
    if daily is None or target_cpa is None:
        return _skip("enforce_budget_formula", "daily_budget or target_cpa missing")
    required = (target_cpa * 50) / 7
    if daily < required:
        return _fail(
            "enforce_budget_formula",
            f"daily ₪{daily} < required ₪{round(required, 2)} = (CPA {target_cpa} × 50) / 7 — "
            f"campaign cannot accumulate 50 conversions in 7 days",
            required_daily_ils=round(required, 2),
        )
    return _pass("enforce_budget_formula", required_daily_ils=round(required, 2))


def _explicit_approval_over_threshold_ils(prop: dict, state: dict, ctx: dict) -> dict:
    if prop.get("task_type") not in ("budget_change", "scale_up"):
        return _pass("explicit_approval_over_threshold_ils")
    pay = prop.get("payload") or {}
    old = pay.get("old_daily_budget_ils") or 0
    new = pay.get("new_daily_budget_ils") or 0
    delta = abs(new - old)
    if delta >= 500 and prop.get("urgency") not in ("high", "urgent"):
        return _fail(
            "explicit_approval_over_threshold_ils",
            f"spend delta ₪{delta}/day ≥ ₪500 requires urgency >= 'high'",
        )
    return _pass("explicit_approval_over_threshold_ils")


# Block 5 (2026-05-12): deterministic checks for guardrails 19-25 added to
# guardrails.md after the §T0r router restructure. Each check follows the
# same _pass / _fail / _skip contract as the older checks above.


def _no_new_creative_when_underspending(prop: dict, state: dict, ctx: dict) -> dict:
    """§19. Block new_creative proposals on campaigns whose utilization_7d
    is below 50% — the bottleneck is delivery, not creative variety."""
    if prop.get("task_type") != "new_creative":
        return _pass("no_new_creative_when_underspending")
    if (prop.get("payload") or {}).get("override_no_new_creative_when_underspending"):
        return _pass(
            "no_new_creative_when_underspending",
            note="explicit operator override in payload",
        )
    util = state.get("utilization_7d")
    if util is None:
        return _skip(
            "no_new_creative_when_underspending",
            "utilization_7d not in state — caller must run §T-1 first",
        )
    if util < 0.5:
        return _fail(
            "no_new_creative_when_underspending",
            f"utilization_7d={round(util * 100, 1)}% < 50% — Meta won't deliver "
            f"existing creatives; adding more is throwing buckets into an empty well",
            utilization_pct=round(util * 100, 1),
        )
    return _pass(
        "no_new_creative_when_underspending",
        utilization_pct=round(util * 100, 1),
    )


def _scale_up_cadence_max_1_per_week(prop: dict, state: dict, ctx: dict) -> dict:
    """§20. At most one executed scale_up / budget_change with positive delta
    on the same target_id in the last 7 days."""
    if prop.get("task_type") not in ("scale_up", "budget_change"):
        return _pass("scale_up_cadence_max_1_per_week")
    # For budget_change, only count it as scale_up when new > old.
    pay = prop.get("payload") or {}
    old = pay.get("old_daily_budget_ils") or pay.get("old_daily_budget_cents") or 0
    new = pay.get("new_daily_budget_ils") or pay.get("new_daily_budget_cents") or 0
    if old and new and float(new) <= float(old):
        return _pass(
            "scale_up_cadence_max_1_per_week",
            note="budget_change with non-positive delta — cadence rule doesn't apply",
        )
    target_id = prop.get("target_id")
    if not target_id:
        return _skip(
            "scale_up_cadence_max_1_per_week",
            "no target_id on proposal — can't query approvals history",
        )
    count = ctx.get("scale_ups_last_7d_on_target", 0) or 0
    if count >= 1:
        return _fail(
            "scale_up_cadence_max_1_per_week",
            f"{count} scale_up/budget_change executed on this campaign in the "
            f"last 7 days — wait for Meta to stabilize before adding another",
            recent_count=count,
        )
    return _pass("scale_up_cadence_max_1_per_week", recent_count=count)


def _marginal_return_check_before_scale_up(prop: dict, state: dict, ctx: dict) -> dict:
    """§21. If a prior scale_up didn't lift conversions by ≥10%, block the
    next one. Reads `marginal_return_passed` from state — caller is expected
    to have run `check_marginal_return.py` first."""
    if prop.get("task_type") not in ("scale_up", "budget_change"):
        return _pass("marginal_return_check_before_scale_up")
    pay = prop.get("payload") or {}
    old = pay.get("old_daily_budget_ils") or pay.get("old_daily_budget_cents") or 0
    new = pay.get("new_daily_budget_ils") or pay.get("new_daily_budget_cents") or 0
    if old and new and float(new) <= float(old):
        return _pass(
            "marginal_return_check_before_scale_up",
            note="non-positive budget delta — rule doesn't apply",
        )
    passed = state.get("marginal_return_passed")
    if passed is None:
        return _skip(
            "marginal_return_check_before_scale_up",
            "marginal_return_passed not in state — caller must run check_marginal_return.py first",
        )
    if passed is False:
        return _fail(
            "marginal_return_check_before_scale_up",
            "prior scale_up did not lift conversions by ≥10% — "
            "throwing more budget at the same setup is the same answer to the same question",
        )
    return _pass("marginal_return_check_before_scale_up")


def _scale_down_max_15pct_per_step(prop: dict, state: dict, ctx: dict) -> dict:
    """§22. Single-step scale_down ≤ 15%. Larger drops break pacing the same
    way large increases do."""
    if prop.get("task_type") != "scale_down":
        return _pass("scale_down_max_15pct_per_step")
    pay = prop.get("payload") or {}
    old = pay.get("old_daily_budget_ils") or pay.get("old_daily_budget_cents")
    new = pay.get("new_daily_budget_ils") or pay.get("new_daily_budget_cents")
    if old is None or new is None or float(old) == 0:
        return _skip(
            "scale_down_max_15pct_per_step",
            "old/new daily budget missing — cannot compute drop magnitude",
        )
    drop_pct = (float(old) - float(new)) / float(old)
    if drop_pct > 0.15:
        return _fail(
            "scale_down_max_15pct_per_step",
            f"drop {round(drop_pct * 100, 1)}% > 15% cap — break into smaller "
            f"steps or pause the campaign and rebuild instead",
            drop_pct=round(drop_pct * 100, 2),
        )
    return _pass("scale_down_max_15pct_per_step", drop_pct=round(drop_pct * 100, 2))


def _no_consecutive_scale_down_14d(prop: dict, state: dict, ctx: dict) -> dict:
    """§23. No two scale_downs on the same campaign within 14 days. Two in a
    row = slow pause; if one didn't fix it, the answer is to change creative
    or audience, not to keep choking budget."""
    if prop.get("task_type") != "scale_down":
        return _pass("no_consecutive_scale_down_14d")
    target_id = prop.get("target_id")
    if not target_id:
        return _skip(
            "no_consecutive_scale_down_14d",
            "no target_id on proposal — can't query approvals history",
        )
    count = ctx.get("scale_downs_last_14d_on_target", 0) or 0
    if count >= 1:
        return _fail(
            "no_consecutive_scale_down_14d",
            "a scale_down was already executed on this campaign within 14 days — "
            "if it didn't help, the issue isn't budget pacing",
            recent_count=count,
        )
    return _pass("no_consecutive_scale_down_14d", recent_count=count)


def _no_scale_down_in_learning(prop: dict, state: dict, ctx: dict) -> dict:
    """§24. scale_down forbidden in LEARNING / LEARNING_LIMITED — budget
    changes reset Learning counter, and a campaign already short of 50
    conversions doesn't need another 7-day setback."""
    if prop.get("task_type") != "scale_down":
        return _pass("no_scale_down_in_learning")
    ls = state.get("learning_status")
    if ls in ("LEARNING", "LEARNING_LIMITED"):
        return _fail(
            "no_scale_down_in_learning",
            f"campaign in {ls} — scale_down would reset the Learning counter; "
            f"only scale_up to budget_daily_min_ils (§3 exception) or emergency pause are legitimate",
            learning_status=ls,
        )
    return _pass("no_scale_down_in_learning", learning_status=ls)


def _set_kpi_target_requires_research(prop: dict, state: dict, ctx: dict) -> dict:
    """§26. `set_kpi_target` proposals MUST include a populated `research`
    block — the agent's live WebSearch findings shaped by business_knowledge,
    not the static fallback band. The contract is in propose_task.py:
    `research` is NOT optional. Required fields: `market_average` (number),
    `sources` (non-empty list of {title,url,extracted}), `context_used`
    (non-empty list of business_knowledge fields that shaped the queries).

    The fallback band in kpi-benchmarks.md is for sanity-checking the
    *researched* value, not for substituting it. Without sources the
    operator can't verify; without context_used we can't tell if the
    research was vertical-specific or generic."""
    if prop.get("task_type") != "set_kpi_target":
        return _pass("set_kpi_target_requires_research")
    payload = prop.get("payload") or {}
    research = payload.get("research")
    if not isinstance(research, dict):
        return _fail(
            "set_kpi_target_requires_research",
            "payload.research missing — set_kpi_target requires live WebSearch "
            "research, not a fallback band lookup. See propose_task.py contract.",
        )
    if not isinstance(research.get("market_average"), int | float):
        return _fail(
            "set_kpi_target_requires_research",
            "payload.research.market_average missing or not numeric — the "
            "researched value the operator can compare against.",
        )
    sources = research.get("sources")
    if not isinstance(sources, list) or len(sources) < 2:
        return _fail(
            "set_kpi_target_requires_research",
            f"payload.research.sources must contain ≥2 entries (got "
            f"{len(sources) if isinstance(sources, list) else 'none'}) — "
            f"single-source values aren't research, and the operator must be "
            f"able to verify each cite.",
        )
    for i, s in enumerate(sources):
        if not isinstance(s, dict):
            return _fail(
                "set_kpi_target_requires_research",
                f"payload.research.sources[{i}] is not an object",
            )
        missing = [k for k in ("title", "url", "extracted") if not s.get(k)]
        if missing:
            return _fail(
                "set_kpi_target_requires_research",
                f"payload.research.sources[{i}] missing keys: {missing}",
            )
    context_used = research.get("context_used")
    if not isinstance(context_used, list) or len(context_used) == 0:
        return _fail(
            "set_kpi_target_requires_research",
            "payload.research.context_used must list which business_knowledge "
            "fields shaped the queries (vertical, products, service_regions, "
            "etc.) — proves the research was business-specific, not generic.",
        )

    # ─── Rationale content checks (added 2026-05-13 per operator feedback) ───
    # Generic "עסק שדומה לך" hides which service was actually analyzed and
    # which competitors anchored the comparison. §26 now requires three
    # specific elements in the rationale text itself. Mirrors the
    # guardrails.md §26 "דרישות תוכן rationale" subsection.
    rationale = (prop.get("rationale") or "").strip()
    if not rationale:
        return _fail(
            "set_kpi_target_requires_research",
            "rationale missing — required to name the analyzed service + competitors.",
        )

    # Check 1: matched_terms (or product names) appear in rationale.
    # estimate_cpl returns `research.match.matched_terms`; if the agent
    # used live WebSearch instead, it may put the same field at the top
    # level. Try both. If neither has entries, accept the explicit fallback
    # phrase "לא זוהה שירות ספציפי".
    match_block = research.get("match") or {}
    matched_terms = (
        match_block.get("matched_terms") if isinstance(match_block, dict) else None
    ) or research.get("matched_terms")
    NO_SERVICE_FALLBACK = "לא זוהה שירות ספציפי"
    if isinstance(matched_terms, list) and matched_terms:
        if not any(str(t) in rationale for t in matched_terms):
            return _fail(
                "set_kpi_target_requires_research",
                f"rationale must name at least one matched term from "
                f"research.match.matched_terms={matched_terms!r} — generic "
                f"'עסק שדומה לך' is blocked. Quote the term verbatim.",
            )
    else:
        if NO_SERVICE_FALLBACK not in rationale:
            return _fail(
                "set_kpi_target_requires_research",
                f"matched_terms empty AND rationale doesn't include the "
                f"fallback phrase '{NO_SERVICE_FALLBACK}'. Either name a "
                f"specific service that matched, or state explicitly that "
                f"no service was identified.",
            )

    # Check 2: campaign_name in rationale (when present).
    campaign_name = match_block.get("campaign_name") if isinstance(match_block, dict) else None
    if (
        isinstance(campaign_name, str)
        and campaign_name.strip()
        and campaign_name.strip() not in rationale
    ):
        return _fail(
            "set_kpi_target_requires_research",
            f"research.match.campaign_name={campaign_name!r} is set but "
            f"the campaign name doesn't appear in the rationale — "
            f"operator can't tell that the research was scoped to this "
            f"specific campaign.",
        )

    # Check 3: competitor citation OR explicit "אין מתחרים מוגדרים".
    # Fetch business_knowledge.competitors directly (small extra query —
    # this rule is set_kpi_target only, which is infrequent).
    NO_COMPETITORS_FALLBACK = "אין מתחרים מוגדרים"
    business_id = prop.get("business_id")
    competitors: list[str] = []
    if business_id:
        try:
            bk_row = fetch_one(
                "SELECT competitors FROM business_knowledge WHERE business_id = %s",
                (business_id,),
            )
            if bk_row and isinstance(bk_row.get("competitors"), list):
                competitors = [str(c) for c in bk_row["competitors"] if c]
        except Exception:
            # DB hiccup shouldn't crash the guardrail — fall back to the
            # phrase-only check below.
            competitors = []
    if competitors:
        if (
            not any(c in rationale for c in competitors)
            and NO_COMPETITORS_FALLBACK not in rationale
        ):
            return _fail(
                "set_kpi_target_requires_research",
                f"business_knowledge.competitors has {len(competitors)} "
                f"entries but none appear in rationale (and the fallback "
                f"phrase '{NO_COMPETITORS_FALLBACK}' is also absent). "
                f"Either cite at least one competitor by name, or "
                f"explicitly note 'אין מתחרים מוגדרים' if you ignored them.",
            )
    elif NO_COMPETITORS_FALLBACK not in rationale:
        return _fail(
            "set_kpi_target_requires_research",
            f"competitors list is empty AND rationale doesn't include "
            f"'{NO_COMPETITORS_FALLBACK}'. State explicitly that no "
            f"competitors were defined so the operator knows the "
            f"comparison is to industry-average, not competitor-specific.",
        )

    return _pass(
        "set_kpi_target_requires_research",
        sources_count=len(sources),
        context_fields=list(context_used),
        matched_terms_cited=bool(matched_terms),
        competitors_cited=len(competitors) > 0,
        campaign_name_cited=bool(campaign_name),
    )


def _no_competitor_hallucinations(prop: dict, state: dict, ctx: dict) -> dict:
    """§27. Flow D competitive-research alerts must have `payload.research`
    with ≥2 sources (each with title+url+extracted) and non-empty
    `context_used`. Any `alert` whose `alert_type` indicates competitive
    research (`target_drift`, `trending_angle`, `new_format`,
    `competitive_*`) is subject to this rule.

    Rationale: the spec placeholder `no_competitor_hallucinations` was
    deferred to v2 in campaigner-spec.md. Promoted to MVP 2026-05-13 when
    Flow D shipped — the operator can't fact-check claims about competitor
    angles or market prices without sources, and the agent's WebSearch
    findings are easy to misremember between the query and the propose.
    Same shape as §26 set_kpi_target_requires_research."""
    if prop.get("task_type") != "alert":
        return _pass("no_competitor_hallucinations")
    payload = prop.get("payload") or {}
    alert_type = payload.get("alert_type") or ""
    competitive_alert_types = (
        "target_drift",
        "trending_angle",
        "new_format",
    )
    if alert_type not in competitive_alert_types and not alert_type.startswith("competitive_"):
        return _pass(
            "no_competitor_hallucinations",
            note=f"alert_type={alert_type!r} is not competitive — rule doesn't apply",
        )
    research = payload.get("research")
    if not isinstance(research, dict):
        return _fail(
            "no_competitor_hallucinations",
            f"alert_type={alert_type!r} requires payload.research — every "
            f"competitive claim needs sources the operator can verify.",
        )
    sources = research.get("sources")
    if not isinstance(sources, list) or len(sources) < 2:
        return _fail(
            "no_competitor_hallucinations",
            f"payload.research.sources must contain ≥2 entries (got "
            f"{len(sources) if isinstance(sources, list) else 'none'}) — "
            f"single-source competitive claims are unverifiable.",
        )
    for i, s in enumerate(sources):
        if not isinstance(s, dict):
            return _fail(
                "no_competitor_hallucinations",
                f"payload.research.sources[{i}] is not an object",
            )
        missing = [k for k in ("title", "url", "extracted") if not s.get(k)]
        if missing:
            return _fail(
                "no_competitor_hallucinations",
                f"payload.research.sources[{i}] missing keys: {missing}",
            )
    context_used = research.get("context_used")
    if not isinstance(context_used, list) or len(context_used) == 0:
        return _fail(
            "no_competitor_hallucinations",
            "payload.research.context_used must list which business_knowledge "
            "fields shaped the queries — proves the research was vertical-"
            "specific, not generic.",
        )
    return _pass(
        "no_competitor_hallucinations",
        alert_type=alert_type,
        sources_count=len(sources),
    )


def _ab_test_requires_min_creatives(prop: dict, state: dict, ctx: dict) -> dict:
    """§29. ab_test_setup payload must contain 2-4 creatives. Block 11
    (2026-05-13)."""
    if prop.get("task_type") != "ab_test_setup":
        return _pass("ab_test_requires_min_creatives")
    payload = prop.get("payload") or {}
    creatives = payload.get("creatives")
    if not isinstance(creatives, list):
        return _fail(
            "ab_test_requires_min_creatives",
            "payload.creatives must be a list (got missing or wrong type)",
        )
    n = len(creatives)
    if n < 2:
        return _fail(
            "ab_test_requires_min_creatives",
            f"payload.creatives has {n} entries — an A/B test needs ≥ 2 variants",
            count=n,
        )
    if n > 4:
        return _fail(
            "ab_test_requires_min_creatives",
            f"payload.creatives has {n} entries — capped at 4 (per-variant samples "
            f"get too thin to decide in 7-14 days)",
            count=n,
        )
    # Variant labels must be A/B/C/D, unique, single letter.
    labels = [c.get("variant_label") for c in creatives if isinstance(c, dict)]
    if len(labels) != n:
        return _fail(
            "ab_test_requires_min_creatives",
            "every creative entry must be an object with variant_label",
        )
    if len(set(labels)) != n:
        return _fail(
            "ab_test_requires_min_creatives",
            f"variant_label values must be unique (got {labels})",
        )
    for label in labels:
        if not isinstance(label, str) or len(label) != 1 or not label.isupper():
            return _fail(
                "ab_test_requires_min_creatives",
                f"variant_label must be a single uppercase letter (got {label!r})",
            )
    return _pass("ab_test_requires_min_creatives", count=n)


def _ab_test_min_window_7d(prop: dict, state: dict, ctx: dict) -> dict:
    """§30. ab_test_setup payload.window_days >= 7. ab_test_decide cannot
    fire before started_at + 7 days unless `cancel_instead=true`. Block 11
    (2026-05-13)."""
    task = prop.get("task_type")
    if task not in ("ab_test_setup", "ab_test_decide"):
        return _pass("ab_test_min_window_7d")
    payload = prop.get("payload") or {}
    if task == "ab_test_setup":
        window = payload.get("window_days")
        try:
            window_i = int(window) if window is not None else None
        except (TypeError, ValueError):
            return _fail(
                "ab_test_min_window_7d",
                f"payload.window_days must be int (got {window!r})",
            )
        if window_i is None:
            return _fail(
                "ab_test_min_window_7d",
                "payload.window_days missing",
            )
        if window_i < 7:
            return _fail(
                "ab_test_min_window_7d",
                f"payload.window_days={window_i} < 7 — Andromeda needs ≥ 7 days "
                f"to stabilize per-variant allocation",
                window_days=window_i,
            )
        if window_i > 90:
            return _fail(
                "ab_test_min_window_7d",
                f"payload.window_days={window_i} > 90 — too long; restart with "
                f"a fresh test after deciding",
                window_days=window_i,
            )
        return _pass("ab_test_min_window_7d", window_days=window_i)
    # task == 'ab_test_decide'
    if payload.get("cancel_instead"):
        return _pass(
            "ab_test_min_window_7d",
            note="cancel_instead=true overrides window check",
        )
    days_elapsed = ctx.get("ab_test_days_elapsed")
    if days_elapsed is None:
        return _skip(
            "ab_test_min_window_7d",
            "ab_test_days_elapsed not in context — caller must populate from "
            "ab_tests.started_at for the proposal's ab_test_id",
        )
    if days_elapsed < 7:
        return _fail(
            "ab_test_min_window_7d",
            f"only {days_elapsed} days elapsed since test started — wait at "
            f"least 7 days before deciding (or pass cancel_instead=true)",
            days_elapsed=days_elapsed,
        )
    return _pass("ab_test_min_window_7d", days_elapsed=days_elapsed)


def _prefer_gallery_over_generation(prop: dict, state: dict, ctx: dict) -> dict:
    """§28. Block `new_creative` proposals when ≥3 viable unused gallery
    assets exist for the same channel/aspect. Operator can override by
    passing `source_preference: 'generate_new'` in the payload, which they
    must do *explicitly* — the agent's default should be reuse-before-regenerate.

    Why: Imagen costs ~$0.02/image and Claude copy generation costs another
    fraction of a cent, but the bigger cost is opportunity. Every fresh
    creative the agent ships is one less ad slot for an asset the operator
    already paid to make. The §T9 organic lane already does gallery-first;
    §T6.1 and §T_PE should match.

    Inputs the check reads:
      ctx['viable_unused_gallery_count_for_channel']  -- from list_active_creatives --unused-in-campaigns --matches-channel
      payload.get('source_preference')                 -- 'generate_new' overrides
      payload.get('channel')                            -- which channel the new creative targets
                                                          (informational; the count is per-channel)

    Block 8 (2026-05-13)."""
    if prop.get("task_type") != "new_creative":
        return _pass("prefer_gallery_over_generation")
    payload = prop.get("payload") or {}
    if payload.get("source_preference") == "generate_new":
        return _pass(
            "prefer_gallery_over_generation",
            note="explicit operator override (source_preference=generate_new)",
        )
    viable = ctx.get("viable_unused_gallery_count_for_channel")
    if viable is None:
        return _skip(
            "prefer_gallery_over_generation",
            "viable_unused_gallery_count_for_channel not in context — caller "
            "must run `list_active_creatives --unused-in-campaigns "
            "--matches-channel <channel>` first",
        )
    if viable >= 3:
        return _fail(
            "prefer_gallery_over_generation",
            f"{viable} viable unused gallery assets exist for this channel — "
            f"propose redeploy_creative on those first, or pass "
            f"source_preference='generate_new' in the payload to override.",
            viable_unused=viable,
        )
    return _pass(
        "prefer_gallery_over_generation",
        viable_unused=viable,
    )


def _respect_hands_off(prop: dict, state: dict, ctx: dict) -> dict:
    """§25. Block structural proposals on campaigns the operator has fenced
    off via `monthly_brief.hands_off_campaign_ids`. Emergency pause overrides.

    `alert` and `observation` are always allowed (informational, no Meta call)."""
    task = prop.get("task_type") or ""
    if task in ("alert",):
        return _pass("respect_hands_off", note="informational task — always allowed")
    target_id = prop.get("target_id") or state.get("campaign_id")
    hands_off = state.get("hands_off_campaign_ids") or []
    if not target_id or not hands_off:
        return _skip(
            "respect_hands_off",
            "no campaign_id on proposal/state OR brief has no hands_off list",
        )
    if not state.get("hands_off_brief_is_current", False):
        return _pass(
            "respect_hands_off",
            note="brief is stale (not current month) — hands_off ignored until refreshed",
        )
    if str(target_id) not in [str(c) for c in hands_off]:
        return _pass("respect_hands_off")
    # Emergency override: CPA > 3× target bypasses hands_off (same exception
    # used by no_pause_on_recent_conversion_24h).
    cpa = state.get("cpa_ils") or 0
    target = state.get("target_cpa_ils") or 0
    if target > 0 and cpa >= target * 3:
        return _pass(
            "respect_hands_off",
            note="emergency CPA > 3× target overrides hands_off — rationale must cite",
        )
    return _fail(
        "respect_hands_off",
        f"campaign {target_id} is in hands_off_campaign_ids for the current month — "
        f"only `alert` or emergency pause allowed",
        target_id=str(target_id),
    )


# --------------------------- §§32-34 — rationale quality (added 2026-05-13)

# Pre-compiled patterns for §32 (approve/reject footer).
# Match the Hebrew words "אישור" / "דחייה" followed within 5 chars by one of = — : ?
_RX_APPROVE = re.compile(r"אישור\s{0,3}[=—:\-]")
_RX_REJECT = re.compile(r"דחייה\s{0,3}[=—:\-]")


def _rationale_has_approve_reject_footer(prop: dict, state: dict, ctx: dict) -> dict:
    """§32. Every rationale must explain what `אשר` and `דחה` actually do.
    Per hebrew-copy-style §11 rule 7 + the 2026-05-13 operator-frustration
    incident where an `alert` proposal was approved/rejected without the
    operator knowing what action either button triggered."""
    rationale = (prop.get("rationale") or "").strip()
    if not rationale:
        return _fail(
            "rationale_has_approve_reject_footer",
            "rationale field is empty — every proposal must justify itself in Hebrew",
        )
    has_approve = bool(_RX_APPROVE.search(rationale))
    has_reject = bool(_RX_REJECT.search(rationale))
    if has_approve and has_reject:
        return _pass("rationale_has_approve_reject_footer")
    missing = []
    if not has_approve:
        missing.append("אישור = ...")
    if not has_reject:
        missing.append("דחייה = ...")
    return _fail(
        "rationale_has_approve_reject_footer",
        "rationale is missing the explicit approve/reject footer required by "
        f"hebrew-copy-style §11 rule 7: missing {', '.join(missing)}",
        missing=missing,
    )


def _alert_requires_acknowledgment_only_flag(prop: dict, state: dict, ctx: dict) -> dict:
    """§33. `task_type='alert'` must carry `payload.acknowledgment_only: true`
    so the UI can render a 'סגור / ראיתי' button pair instead of 'אשר / דחה' —
    there is no Meta call behind an alert, only an acknowledgement.

    If you have a real action to take, use the correct task_type, not alert."""
    if prop.get("task_type") != "alert":
        return _skip("alert_requires_acknowledgment_only_flag", "non-alert task_type")
    payload = prop.get("payload") or {}
    flag = payload.get("acknowledgment_only")
    if flag is True:
        return _pass("alert_requires_acknowledgment_only_flag")
    return _fail(
        "alert_requires_acknowledgment_only_flag",
        "alert payload must set `acknowledgment_only: true` — per the contract "
        "in propose_task.py + guardrail §33. If there IS a real action behind "
        "approval, use the correct task_type (set_kpi_target, publish_*, "
        "boost_post, ...) instead of alert.",
        got=repr(flag),
    )


# Forbidden tokens in paragraph 1 — categorized for clear error messages.
# Each entry: (regex, category-label-Hebrew). regex must be case-sensitive
# for English tokens; Hebrew loanwords like פיקסל / סטוריז / ריילז / פיד remain
# legal (those are the substitutes §11 prescribes).
_FORBIDDEN_PARA1: list[tuple[re.Pattern[str], str]] = [
    # Metric acronyms
    (re.compile(r"\b(CPM|CTR|CPA|CPL|CPR|CPC|CPI|ROAS)\b"), "ראשי תיבות מטריקות"),
    # Meta engine / feature names
    (re.compile(r"\b(Andromeda|Advantage\+|Advantage Plus|Dynamic Creative)\b"), "מנועי Meta"),
    # Meta state strings
    (
        re.compile(
            r"\b(LEARNING_LIMITED|LEARNING LIMITED|CAMPAIGN_LIMITED|LEARNING|ACTIVE|INACTIVE|PAUSED|LIMITED)\b"
        ),
        "מצבי Meta",
    ),
    # English placement names (סטוריז / ריילז / פיד בעברית מותרים)
    (
        re.compile(r"\b(Stories|Reels|Feed|Right Column|Audience Network)\b"),
        "שמות פלייסמנט באנגלית",
    ),
    # Meta CTA enum tokens
    (
        re.compile(
            r"\b(MESSAGE_PAGE|LEARN_MORE|SIGN_UP|SHOP_NOW|GET_OFFER|CONTACT_US|SEND_MESSAGE)\b"
        ),
        "אסימוני CTA",
    ),
    # Agent-internal jargon
    (re.compile(r"\bFlow\s+[A-D]\b"), "מסלולי סוכן (Flow A/B/C/D)"),
    (
        re.compile(
            r"\b(dispatcher|tracking gate|tracking health|task_type|business_knowledge|monthly_brief|propose_task|execute_task|verify_pixel_capi|agent_decisions)\b"
        ),
        "אסימוני סוכן פנימיים",
    ),
    (re.compile(r"\b\w+\.(py|sql|md)(:\d+)?\b"), "הפניות לקבצי קוד"),
    # Meta engineering jargon
    (
        re.compile(
            r"\b(AEM|CAPI|Conversions API|Aggregated Event Measurement|Events Manager|Business Manager|Graph API|Marketing API|Pixel ID)\b"
        ),
        "מונחים הנדסיים של Meta",
    ),
]


def _rationale_paragraph_1_clean(prop: dict, state: dict, ctx: dict) -> dict:
    """§34. Paragraph 1 of rationale must contain none of the forbidden
    English/agent-internal tokens listed in hebrew-copy-style §11. A
    non-marketer operator must be able to read paragraph 1 and decide
    approve/reject without a glossary."""
    rationale = (prop.get("rationale") or "").strip()
    if not rationale:
        return _skip("rationale_paragraph_1_clean", "empty rationale — caught by §32")
    # Paragraph 1 = text before first blank line OR first 400 chars
    parts = re.split(r"\n\s*\n", rationale, maxsplit=1)
    para1 = parts[0] if parts else rationale
    if len(para1) > 400:
        para1 = para1[:400]
    hits: list[dict[str, str]] = []
    for rx, category in _FORBIDDEN_PARA1:
        for m in rx.finditer(para1):
            hits.append({"token": m.group(0), "category": category})
    if not hits:
        return _pass("rationale_paragraph_1_clean")
    # Deduplicate while preserving order
    seen = set()
    unique_hits = []
    for h in hits:
        key = (h["token"], h["category"])
        if key not in seen:
            seen.add(key)
            unique_hits.append(h)
    return _fail(
        "rationale_paragraph_1_clean",
        "paragraph 1 of rationale contains forbidden English/agent tokens — "
        "operator without marketing background can't read it. Translate to "
        "plain Hebrew (see hebrew-copy-style §11 forbidden-tokens table).",
        forbidden_tokens=unique_hits,
    )


# --------------------------------------------------------------------------
# Phase 1 (2026-05-13 evening): audience rules §§35-36
# --------------------------------------------------------------------------


def _audience_size_min_for_lookalike(prop: dict, state: dict, ctx: dict) -> dict:
    """§35 — Lookalike audiences require a seed of ≥ 100 people (Meta minimum).

    Blocks `create_lookalike` proposals whose `origin_audience_id` references
    a seed whose `approximate_count_upper_bound` (in `meta_audiences`) is
    under 100. We use the upper bound rather than the lower so the operator
    gets the optimistic threshold; if even the upper bound is below 100, the
    seed truly cannot spawn a Lookalike.
    """
    if prop.get("task_type") != "create_lookalike":
        return _pass("audience_size_min_for_lookalike", note="not a create_lookalike task")
    pay = prop.get("payload") or {}
    origin = pay.get("origin_audience_id")
    business_id = prop.get("business_id") or ctx.get("business_id")
    if not origin:
        return _fail(
            "audience_size_min_for_lookalike",
            "create_lookalike payload missing origin_audience_id",
        )
    if not business_id:
        return _skip(
            "audience_size_min_for_lookalike",
            "business_id not available — cannot resolve seed size",
        )
    row = fetch_one(
        "SELECT name, approximate_count_lower_bound AS low, "
        "approximate_count_upper_bound AS up "
        "FROM meta_audiences WHERE business_id = %s AND meta_audience_id = %s "
        "AND archived_at IS NULL",
        (business_id, str(origin)),
    )
    if not row:
        return _fail(
            "audience_size_min_for_lookalike",
            f"seed audience {origin} not found in meta_audiences "
            "(run sync_audiences before proposing)",
        )
    up = row.get("up") or 0
    if up < 100:
        return _fail(
            "audience_size_min_for_lookalike",
            f"seed '{row.get('name')}' upper-bound count {up} < 100 "
            "(Meta requires ≥ 100 for Lookalike)",
            seed_upper_bound=up,
        )
    return _pass(
        "audience_size_min_for_lookalike",
        seed_name=row.get("name"),
        seed_upper_bound=up,
    )


def _audience_targeting_not_double_narrowed(prop: dict, state: dict, ctx: dict) -> dict:
    """§36 — Don't stack a custom audience ID together with narrow interest
    targeting on the same ad set.

    Andromeda Audience handles broadening on its own when a CA / LAL is the
    seed. Adding narrow interest filters on top defeats Meta's expansion and
    starves the algorithm of optimization room. This rule fires on
    `expand_audience` / `new_campaign` proposals whose targeting payload has
    BOTH a non-empty `custom_audiences` AND a non-empty `interests` /
    `flexible_spec` block (the usual narrow-interest carriers).
    """
    task = prop.get("task_type")
    if task not in ("expand_audience", "new_campaign"):
        return _pass(
            "audience_targeting_not_double_narrowed",
            note="not an audience-bearing task_type",
        )
    pay = prop.get("payload") or {}
    # Audience IDs can arrive as the dedicated Phase-1 payload keys OR baked
    # into a raw Meta targeting spec under new_targeting.custom_audiences.
    ca_ids = pay.get("custom_audience_ids") or pay.get("lookalike_audience_ids") or []
    targeting = pay.get("new_targeting") or pay.get("targeting") or {}
    if isinstance(targeting, dict):
        for entry in targeting.get("custom_audiences") or []:
            if isinstance(entry, dict) and entry.get("id"):
                ca_ids.append(entry["id"])

    if not ca_ids:
        return _pass(
            "audience_targeting_not_double_narrowed",
            note="no custom_audience_ids — rule does not apply",
        )

    narrow_signals: list[str] = []
    if isinstance(targeting, dict):
        if targeting.get("interests"):
            narrow_signals.append("interests")
        if targeting.get("flexible_spec"):
            narrow_signals.append("flexible_spec")
        if targeting.get("behaviors"):
            narrow_signals.append("behaviors")
    if not narrow_signals:
        return _pass(
            "audience_targeting_not_double_narrowed",
            custom_audience_count=len(ca_ids),
            note="custom audience used without narrow interest filters",
        )
    return _fail(
        "audience_targeting_not_double_narrowed",
        f"proposal stacks {len(ca_ids)} custom audience(s) with narrow targeting "
        f"({', '.join(narrow_signals)}) — Andromeda prefers broad-with-CA. "
        "Drop the narrow interests, or pass `source_preference: 'targeted_narrow'` "
        "with an explicit reason in the rationale.",
        custom_audience_count=len(ca_ids),
        narrow_signals=narrow_signals,
    )


# §37 — feedback loop (added 2026-05-13 PM, the "real campaigner" milestone).
# Pre-compiled patterns that indicate the agent acknowledged a prior rejection
# in the current rationale. Tolerant matching: any of these counts as "the
# agent addressed the rejection" — we don't enforce exact phrasing.
_PRIOR_REJECTION_ACK_RX = re.compile(
    r"(דחית[יה]?|דחי[יי]ה\s+קודמת|בפעם\s+(?:הקודמת|שעברה)|"
    r"הפעם\s+שונה|השתנה|תיקנתי|למדתי\s+מהדחי[יי]ה|מהתשובה\s+הקודמת)"
)


def _respect_prior_rejections(prop: dict, state: dict, ctx: dict) -> dict:
    """§37. Block a re-proposal of the same (task_type, target_id) that was
    rejected with a non-bulk reason in the last 60 days, unless the rationale
    explicitly acknowledges + differentiates.

    Context: `ctx['prior_rejections_60d']` is a list of dicts with at least
    {rejection_reason, rejected_on} for prior rejections matching this proposal's
    (task_type, target_kind, target_id). Populated by _fetch_context when both
    target_id and task_type are present.

    Skip cases (returns _skip):
      - context not populated (caller didn't run load_feedback_history)
      - no prior rejections found
      - task_type='alert' with acknowledgment_only — these are queue housekeeping,
        not actionable proposals, so re-proposing the same ack is fine.
    """
    prior = ctx.get("prior_rejections_60d")
    if prior is None:
        return _skip(
            "respect_prior_rejections",
            "context.prior_rejections_60d not provided — caller didn't load feedback history",
        )
    if not prior:
        return _pass("respect_prior_rejections", note="no prior rejections in last 60d")
    # Ack alerts are queue-management, not advice. Operators close them; the
    # next run can re-emit a fresh ack without "you rejected this before".
    if prop.get("task_type") == "alert":
        payload = prop.get("payload") or {}
        if payload.get("acknowledgment_only") is True:
            return _pass(
                "respect_prior_rejections",
                note="ack-only alert is exempt — informational, not actionable",
            )
    rationale = prop.get("rationale") or ""
    if _PRIOR_REJECTION_ACK_RX.search(rationale):
        return _pass(
            "respect_prior_rejections",
            note="rationale acknowledges prior rejection",
            prior_rejection_count=len(prior),
        )
    return _fail(
        "respect_prior_rejections",
        f"this (task_type, target) was rejected {len(prior)} time(s) in the last "
        f"60 days. Rationale must cite the prior rejection and explain what's "
        f"different now — or skip the proposal. See guardrail §37.",
        prior_rejections=prior[:3],  # cap at 3 for output size
    )


# §38 — new_campaign payload completeness (added 2026-05-13 PM, operator audit).
# Schema for what a complete `new_campaign` payload must contain. See
# propose_task.py docstring on the `new_campaign` task_type for the full contract.
_NEW_CAMPAIGN_TOP_FIELDS = ["campaign_name", "objective", "special_ad_categories"]
_NEW_CAMPAIGN_ADSET_FIELDS = ["adset_name", "optimization_goal", "billing_event"]
_NEW_CAMPAIGN_AD_FIELDS = ["ad_name", "creative_kind"]
_OBJECTIVES_REQUIRING_PIXEL = ("OUTCOME_SALES",)
_OBJECTIVES_REQUIRING_PAGE = ("OUTCOME_LEADS", "OUTCOME_ENGAGEMENT")


# §39 — respect_active_plans (added 2026-05-13 PM, junior→consultant #2).
# Match Hebrew tokens that indicate the rationale acknowledges a prior commitment.
_ACTIVE_PLAN_ACK_RX = re.compile(
    r"(בריצה\s+הקודמת|התחייבתי|תוכנית\s+מ-|בתוכנית|הצעד\s+הבא|"
    r"כפי\s+שאמרתי|כפי\s+שתכננתי|כפי\s+שהתחייבתי|המשך\s+התוכנית)"
)


def _respect_active_plans(prop: dict, state: dict, ctx: dict) -> dict:
    """§39. If a forward-looking plan step exists for this target_id (committed
    in a prior approved/executed proposal within 21 days), the rationale must
    acknowledge it — either as the next step in the plan, or as an explicit
    supersession.

    Context: `ctx['active_plans_for_target']` is a list of dicts with at least
    {approval_id, committed_on, forward_steps[]}. Populated by _fetch_context
    when target_id is present.

    Skip cases:
      - context not populated (caller didn't load active plans)
      - no plans for this target
      - ack-only alert (informational, not actionable)
    """
    plans = ctx.get("active_plans_for_target")
    if plans is None:
        return _skip(
            "respect_active_plans",
            "context.active_plans_for_target not provided — caller didn't load active plans",
        )
    if not plans:
        return _pass("respect_active_plans", note="no active plans for this target")
    if prop.get("task_type") == "alert":
        payload = prop.get("payload") or {}
        if payload.get("acknowledgment_only") is True:
            return _pass(
                "respect_active_plans",
                note="ack-only alert exempt — not a forward action",
            )
    rationale = prop.get("rationale") or ""
    if _ACTIVE_PLAN_ACK_RX.search(rationale):
        return _pass(
            "respect_active_plans",
            note="rationale acknowledges prior plan",
            active_plan_count=len(plans),
        )
    return _fail(
        "respect_active_plans",
        f"this target has {len(plans)} active plan step(s) from prior approvals "
        f"within 21 days. Rationale must either advance the plan (cite + take "
        f"the next step) or explicitly supersede it. See guardrail §39.",
        active_plans=plans[:3],
    )


def _new_campaign_payload_completeness(prop: dict, state: dict, ctx: dict) -> dict:
    """§38. Reject `new_campaign` proposals missing required campaign + ad set +
    ad fields. The payload contract is documented on the `new_campaign` entry
    in propose_task.py.

    Returns _skip for non-new_campaign task_types — this is one of the few
    rules where the agent shouldn't see "passed" noise when irrelevant."""
    if prop.get("task_type") != "new_campaign":
        return _skip("new_campaign_payload_completeness", "non-new_campaign task_type")
    payload = prop.get("payload") or {}
    if not isinstance(payload, dict):
        return _fail(
            "new_campaign_payload_completeness",
            "payload must be a JSON object — see propose_task.py new_campaign contract",
        )
    missing: list[str] = []

    # Top-level
    for f in _NEW_CAMPAIGN_TOP_FIELDS:
        if f == "special_ad_categories":
            # The field must exist (even if empty list) — Meta requires explicit declaration.
            if "special_ad_categories" not in payload:
                missing.append("special_ad_categories (must be present, may be [])")
        elif not payload.get(f):
            missing.append(f)
    # Budget: exactly one of daily / lifetime
    has_daily = payload.get("daily_budget_ils") is not None
    has_lifetime = payload.get("lifetime_budget_ils") is not None
    if not has_daily and not has_lifetime:
        missing.append("daily_budget_ils OR lifetime_budget_ils (one required)")
    if has_daily and has_lifetime:
        missing.append("only ONE of daily_budget_ils / lifetime_budget_ils (got both)")

    # Ad set fields
    for f in _NEW_CAMPAIGN_ADSET_FIELDS:
        if not payload.get(f):
            missing.append(f)
    # Targeting subfields
    targeting = payload.get("targeting") or {}
    if not isinstance(targeting, dict):
        missing.append("targeting (must be object)")
    else:
        geo = targeting.get("geo_locations") or {}
        # geo_locations must have at least countries / regions / cities / zips
        if not isinstance(geo, dict) or not any(
            geo.get(k) for k in ("countries", "regions", "cities", "zips")
        ):
            missing.append("targeting.geo_locations (at minimum countries=['IL'])")
        if not targeting.get("age_min"):
            missing.append("targeting.age_min (Meta requires; min 18 in 2026)")

    # promoted_object — required conditionally on objective
    objective = payload.get("objective") or ""
    promoted = payload.get("promoted_object") or {}
    if objective in _OBJECTIVES_REQUIRING_PIXEL:
        if not promoted.get("pixel_id"):
            missing.append("promoted_object.pixel_id (required for OUTCOME_SALES)")
        if not promoted.get("custom_event_type"):
            missing.append(
                "promoted_object.custom_event_type (required for OUTCOME_SALES — e.g. PURCHASE)"
            )
    if objective in _OBJECTIVES_REQUIRING_PAGE and not promoted.get("page_id"):
        missing.append(f"promoted_object.page_id (required for {objective})")

    # Ad fields
    for f in _NEW_CAMPAIGN_AD_FIELDS:
        if not payload.get(f):
            missing.append(f)
    creative_source = payload.get("creative_source") or {}
    if not isinstance(creative_source, dict) or not any(
        creative_source.get(k)
        for k in ("image_path", "creative_gallery_id", "video_path", "existing_post_id")
    ):
        missing.append(
            "creative_source.{image_path|creative_gallery_id|video_path|existing_post_id} "
            "(at least one)"
        )
    copy = payload.get("copy") or {}
    if not isinstance(copy, dict):
        missing.append("copy (must be object)")
    else:
        for f in ("headline", "primary_text", "cta", "link_url"):
            if not copy.get(f):
                missing.append(f"copy.{f}")
    identity = payload.get("identity") or {}
    if not isinstance(identity, dict) or not identity.get("page_id"):
        missing.append("identity.page_id")

    if missing:
        return _fail(
            "new_campaign_payload_completeness",
            f"new_campaign payload missing {len(missing)} required field(s) — see "
            f"propose_task.py docstring + guardrails.md §38",
            missing_fields=missing,
        )
    return _pass("new_campaign_payload_completeness")


# --------------------------------------------------------------------------
# Phase 2 (2026-05-13 evening): §40 winner_requires_quality_grade
# --------------------------------------------------------------------------


def _winner_requires_quality_grade(prop: dict, state: dict, ctx: dict) -> dict:
    """§40 — Don't scale a campaign whose leads are graded as low quality.

    The 16.4 lesson (mastery plan §1): Roi paused the best-on-Meta campaign
    because the leads weren't qualified business. Cheap CPL/CPM ≠ winner.

    Blocks: `scale_up`, `budget_change` (when payload signals an increase),
    `new_creative`, `expand_audience` — but only when the target campaign
    has enough lead data to evaluate (≥ 5 leads in the window).

    Decision matrix on `lead_quality_status` from context:
      - 'no_leads' / 'insufficient_grades' → _skip (need more grades first;
                                              agent should propose grading
                                              prompts, not scaling)
      - 'all_spam' / 'low_quality'         → _fail (don't pour money in)
      - 'mixed_quality'                    → _pass with `note=monitor_quality`
      - 'high_quality'                     → _pass

    State input is `lead_quality_status` — populated by `_fetch_context`
    when a campaign_id is present on the proposal. Caller (the agent) must
    also have run `fetch_lead_quality_summary` so the operator sees the
    same number in the rationale.
    """
    task = prop.get("task_type")
    SCALING_TASKS = {"scale_up", "budget_change", "new_creative", "expand_audience"}
    if task not in SCALING_TASKS:
        return _pass("winner_requires_quality_grade", note="not a scaling task_type")

    # For budget_change, only enforce on increases.
    if task == "budget_change":
        pay = prop.get("payload") or {}
        old = pay.get("old_daily_budget_cents") or pay.get("old_daily_budget_ils") or 0
        new = pay.get("new_daily_budget_cents") or pay.get("new_daily_budget_ils") or 0
        try:
            if float(new) <= float(old):
                return _pass(
                    "winner_requires_quality_grade",
                    note="budget decrease — rule does not apply",
                )
        except (TypeError, ValueError):
            pass

    status = ctx.get("lead_quality_status") or state.get("lead_quality_status")
    leads_total = ctx.get("lead_quality_leads_total") or 0
    avg_grade = ctx.get("lead_quality_avg_grade")
    effective_ratio = ctx.get("lead_quality_effective_ratio")

    if status is None:
        return _skip(
            "winner_requires_quality_grade",
            "lead_quality_status not in context — caller must run "
            "fetch_lead_quality_summary before proposing scaling actions",
        )

    if status in ("no_leads",):
        # No leads from this campaign yet — can't apply the rule, but the
        # agent should know. Pass with a heads-up note.
        return _pass(
            "winner_requires_quality_grade",
            note="no leads from this campaign yet — quality unknown but rule does not apply",
            leads_total=leads_total,
        )

    if status == "insufficient_grades":
        return _skip(
            "winner_requires_quality_grade",
            f"only {ctx.get('lead_quality_leads_graded', 0)} of {leads_total} "
            "leads graded — need ≥ 5 grades. Propose grading prompts to the "
            "operator before scaling.",
        )

    if status in ("low_quality", "all_spam"):
        return _fail(
            "winner_requires_quality_grade",
            f"lead quality is {status} (avg_grade={avg_grade}, "
            f"effective_ratio={effective_ratio}) — scaling spend on a "
            "campaign producing poor leads is the 16.4 trap. Pause or "
            "rework targeting/creative first, then re-evaluate.",
            lead_quality_status=status,
            avg_grade=avg_grade,
            effective_ratio=effective_ratio,
        )

    if status == "mixed_quality":
        return _pass(
            "winner_requires_quality_grade",
            note="mixed_quality — monitor lead quality post-scale",
            lead_quality_status=status,
            avg_grade=avg_grade,
        )

    # high_quality
    return _pass(
        "winner_requires_quality_grade",
        lead_quality_status=status,
        avg_grade=avg_grade,
    )


# --------------------------------------------------------------------------
# Phase 3 (2026-05-13 evening): §41 campaign_objective_aligned_with_kpi
# --------------------------------------------------------------------------

# Objectives that produce reliable signal for each primary KPI. The agent
# may still propose a non-aligned pair with an explicit
# `objective_kpi_misalignment_reason` in the payload — that downgrades the
# fail to a warning-pass.
_KPI_OBJECTIVE_FIT: dict[str, set[str]] = {
    "cpl": {"OUTCOME_LEADS", "OUTCOME_ENGAGEMENT"},  # leads form OR messaging
    "cpa": {"OUTCOME_SALES", "OUTCOME_LEADS"},  # purchase OR registration
    "roas": {"OUTCOME_SALES"},
    "cpm": {"OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT"},
    "cpi": {"OUTCOME_APP_PROMOTION"},
}


def _campaign_objective_aligned_with_kpi(prop: dict, state: dict, ctx: dict) -> dict:
    """§41 — A new_campaign's objective must produce signal for the business
    KPI. Otherwise the proposal builds a Meta campaign that can't be evaluated.

    Reads `primary_kpi` from context (sourced from businesses.primary_kpi
    via load_business_knowledge). If the proposal's objective doesn't appear
    in `_KPI_OBJECTIVE_FIT[primary_kpi]`, fail — unless the payload has an
    explicit `objective_kpi_misalignment_reason` (Hebrew operator-facing
    string), in which case downgrade to pass with a warning.
    """
    if prop.get("task_type") != "new_campaign":
        return _pass(
            "campaign_objective_aligned_with_kpi",
            note="rule only applies to new_campaign",
        )
    pay = prop.get("payload") or {}
    objective = pay.get("objective")
    if not objective:
        return _skip(
            "campaign_objective_aligned_with_kpi",
            "new_campaign payload missing objective — §38 should have caught this",
        )

    primary_kpi = ctx.get("primary_kpi") or state.get("primary_kpi")
    if not primary_kpi:
        return _skip(
            "campaign_objective_aligned_with_kpi",
            "primary_kpi not in context — load_business_knowledge must run "
            "before guardrails for this rule to apply",
        )

    fit = _KPI_OBJECTIVE_FIT.get(primary_kpi.lower())
    if not fit:
        return _skip(
            "campaign_objective_aligned_with_kpi",
            f"unknown primary_kpi='{primary_kpi}' — rule does not apply",
        )

    if objective in fit:
        return _pass(
            "campaign_objective_aligned_with_kpi",
            primary_kpi=primary_kpi,
            objective=objective,
        )

    reason = pay.get("objective_kpi_misalignment_reason")
    if reason and len(str(reason).strip()) >= 30:
        return _pass(
            "campaign_objective_aligned_with_kpi",
            warning=True,
            note=(
                f"objective={objective} doesn't match primary_kpi={primary_kpi}, "
                f"but operator-facing reason provided: '{str(reason)[:120]}'"
            ),
            primary_kpi=primary_kpi,
            objective=objective,
        )

    return _fail(
        "campaign_objective_aligned_with_kpi",
        f"objective='{objective}' produces no signal for primary_kpi='{primary_kpi}' "
        f"(expected one of {sorted(fit)}). Either change objective, change "
        f"primary_kpi, or supply payload.objective_kpi_misalignment_reason "
        f"(Hebrew, ≥30 chars) explaining why this campaign is intentionally "
        f"measured outside the KPI.",
        primary_kpi=primary_kpi,
        objective=objective,
        accepted_objectives=sorted(fit),
    )


# --------------------------------------------------------------------------
# Phase 1 add-on (migration 025, 2026-05-13): §42 geo_targeting_set_for_new_campaign
# --------------------------------------------------------------------------


def _geo_targeting_set_for_new_campaign(prop: dict, state: dict, ctx: dict) -> dict:
    """§42 — Warn (do not block) when a new_campaign is proposed and the
    business has no `geo_targeting` configured in business_knowledge.

    Background: per migration 025, geo_targeting is the source of truth for
    every new_campaign's `targeting.geo_locations` + `excluded_geo_locations`.
    When it's null, `draft_new_campaign_payload._build_geo_targeting()` falls
    back to country-level defaults (typically just `{"countries": ["IL"]}`).
    That's an OK fallback for the very first campaign on a brand-new account
    but Roi explicitly called out 2026-05-13 that "all of Israel" pulls
    leads from areas the operator doesn't want — wasted spend AND junk leads.

    This rule emits a warning-pass so the operator sees the gap on the
    approval card without the proposal being blocked outright. Set
    geo_targeting via /business-knowledge to clear the warning.
    """
    if prop.get("task_type") != "new_campaign":
        return _pass(
            "geo_targeting_set_for_new_campaign",
            note="rule only applies to new_campaign",
        )

    business_id = prop.get("business_id") or ctx.get("business_id")
    if not business_id:
        return _skip(
            "geo_targeting_set_for_new_campaign",
            "business_id not available — cannot resolve geo_targeting state",
        )

    row = fetch_one(
        "SELECT geo_targeting FROM business_knowledge WHERE business_id = %s",
        (business_id,),
    )
    geo = (row or {}).get("geo_targeting")
    # Treat null, empty dict, or "include with no positive geo at all" as missing.
    has_geo = False
    if isinstance(geo, dict):
        include = geo.get("include")
        if isinstance(include, dict) and any(
            include.get(k) for k in ("countries", "regions", "cities", "radius_centers", "zips")
        ):
            has_geo = True

    if has_geo:
        return _pass(
            "geo_targeting_set_for_new_campaign",
            note="business_knowledge.geo_targeting populated",
        )

    return _pass(
        "geo_targeting_set_for_new_campaign",
        warning=True,
        note=(
            "business_knowledge.geo_targeting is empty/null — this new_campaign "
            "will inherit Meta's broad-country default (typically all of IL). "
            "Roi: that's the spend-spread you flagged. Set per-business geo at "
            "/business-knowledge → 'גיאוגרפיה לקמפיינים' to constrain the pool "
            "and add explicit exclusions before scaling."
        ),
    )


# §40 — customer-facing copy forbidden-lexicon (added 2026-05-13 PM).
# Mirrors compose_copy_brief.py's forbidden_tokens lists so the agent's brief
# and the guardrail enforcement stay in sync.
_FORBIDDEN_COPY_TOKENS_PAN_IL = [
    "לחץ כאן",
    "מוגבל בזמן!",
    "הזדמנות של פעם בחיים",
    "מהפכה",
    "פריצת דרך",
    "בלעדי",
    "!!!",
    "???",
    "חינם!!",
    "רק היום",
]
_FORBIDDEN_COPY_TOKENS_AIWEON = [
    "המוביל",
    "מספר 1",
    "הטוב ביותר",
    "פורץ דרך",
    "מהפכני",
    "פתרון 360",
    "end-to-end",
    "holistic",
    "ecosystem",
    "synergy",
    "workflow",
    "funnel",
    "engagement",
]
# Specific-ROI claim pattern: "X3 לידים", "פי 5 מכירות", "חיסכון של 80%", etc.
_RX_SPECIFIC_ROI_CLAIM = re.compile(
    r"(?:[Xx]\s*\d+|פי\s+\d+|חיסכון\s+של\s+\d+%|\d+%\s+תוצאות|\d+%\s+יותר)"
)
# AI overuse — count occurrences of "AI" or "בינה מלאכותית".
_RX_AI_MENTIONS = re.compile(r"\b(?:AI|בינה\s+מלאכותית)\b")

# Task types that carry customer-facing copy (subset; alert/scale/etc skipped).
_COPY_BEARING_TASKS = (
    "new_campaign",
    "new_creative",
    "redeploy_creative",
)


def _gather_copy_strings(prop: dict) -> list[tuple[str, str]]:
    """Return [(field_name, text), ...] for every copy field this proposal carries.
    Returns [] for task_types that don't bear copy."""
    task = prop.get("task_type")
    if task not in _COPY_BEARING_TASKS:
        return []
    payload = prop.get("payload") or {}
    if not isinstance(payload, dict):
        return []
    out: list[tuple[str, str]] = []
    # new_campaign uses nested copy block (per propose_task.py docstring).
    copy = payload.get("copy")
    if isinstance(copy, dict):
        for k in ("headline", "primary_text", "description"):
            v = copy.get(k)
            if isinstance(v, str) and v.strip():
                out.append((f"copy.{k}", v))
    # new_creative / redeploy_creative may have flat keys too.
    for k in ("headline", "primary_text", "description"):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            out.append((k, v))
    # boost_post: skip unless explicit override (per §40 doc).
    if task == "boost_post":
        return [(f, t) for f, t in out if f.startswith("copy.")]
    return out


def _copy_must_match_brief_voice(prop: dict, state: dict, ctx: dict) -> dict:
    """§40. Customer-facing copy must not contain forbidden lexicon from
    hebrew-copy-style §3 (pan-Israeli + Aiweon-specific). Distinct from §34
    which enforces *operator-rationale* paragraph 1; §40 enforces the
    *customer-facing* copy in the payload."""
    copies = _gather_copy_strings(prop)
    if not copies:
        return _skip("copy_must_match_brief_voice", "task_type doesn't bear customer copy")
    hits: list[dict[str, str]] = []
    ai_total = 0
    for field, text in copies:
        for token in _FORBIDDEN_COPY_TOKENS_PAN_IL:
            if token in text:
                hits.append({"field": field, "token": token, "category": "pan_israeli_spam"})
        for token in _FORBIDDEN_COPY_TOKENS_AIWEON:
            if token in text:
                hits.append({"field": field, "token": token, "category": "aiweon_forbidden"})
        # Specific-ROI claims (regex)
        for m in _RX_SPECIFIC_ROI_CLAIM.finditer(text):
            hits.append(
                {"field": field, "token": m.group(0), "category": "specific_roi_without_data"}
            )
        ai_total += len(_RX_AI_MENTIONS.findall(text))
    if ai_total > 1:
        hits.append(
            {
                "field": "(combined copy fields)",
                "token": f"AI mentioned {ai_total} times",
                "category": "ai_overuse_max_one",
            }
        )
    if not hits:
        return _pass("copy_must_match_brief_voice")
    # Dedup
    seen: set[tuple] = set()
    unique = []
    for h in hits:
        key = (h["field"], h["token"], h["category"])
        if key not in seen:
            seen.add(key)
            unique.append(h)
    return _fail(
        "copy_must_match_brief_voice",
        f"customer copy contains {len(unique)} forbidden token(s) from hebrew-copy-style "
        f"§3 — see compose_copy_brief.py forbidden_tokens. Translate before retrying.",
        forbidden_tokens_in_copy=unique,
    )


_VALID_QUESTION_ID_RX = re.compile(r"^[a-z0-9_]{1,40}$")

_FIRST_CAMPAIGN_OBJECTIVES = {
    "OUTCOME_LEADS",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_TRAFFIC",
    "OUTCOME_SALES",
    "OUTCOME_AWARENESS",
    "OUTCOME_APP_PROMOTION",
}


def _first_campaign_payload_completeness(prop: dict, state: dict, ctx: dict) -> dict:
    """§47. Mastery v2 Phase A. The first_campaign proposal must include the
    fields the onboarding chain depends on. This is a lighter check than §38
    (`new_campaign_payload_completeness`) because the actual Meta-side payload
    is built by /campaigns/new prefill, not stored on the approval directly —
    the first_campaign approval is an *invitation* to open the wizard, not a
    full Meta object spec.

    Required fields in payload:
      * step == "first_campaign"
      * target_url starts with "/campaigns/new"
      * recommended_daily_budget_ils: number > 0
      * objective_recommendation: one of the OUTCOME_* enum
      * audience_summary_he: non-empty string
      * acknowledgment_only: True (the operator clicks through to /campaigns/new
        to actually create the Meta object; the approval itself doesn't fire
        a Meta call)
    """
    if prop.get("task_type") != "first_campaign":
        return _skip("first_campaign_payload_completeness", "not a first_campaign task")
    payload = prop.get("payload")
    if not isinstance(payload, dict):
        return _fail("first_campaign_payload_completeness", "payload must be a dict")
    missing: list[str] = []
    if payload.get("step") != "first_campaign":
        missing.append("step (must equal 'first_campaign')")
    target_url = payload.get("target_url")
    if not isinstance(target_url, str) or not target_url.startswith("/campaigns/new"):
        missing.append("target_url (must start with /campaigns/new)")
    daily_budget = payload.get("recommended_daily_budget_ils")
    if not isinstance(daily_budget, int | float) or daily_budget <= 0:
        missing.append("recommended_daily_budget_ils (must be > 0)")
    objective = payload.get("objective_recommendation")
    if objective not in _FIRST_CAMPAIGN_OBJECTIVES:
        missing.append(
            f"objective_recommendation (must be one of {sorted(_FIRST_CAMPAIGN_OBJECTIVES)})"
        )
    audience_summary = payload.get("audience_summary_he")
    if not isinstance(audience_summary, str) or len(audience_summary.strip()) == 0:
        missing.append("audience_summary_he (Hebrew one-line summary)")
    if payload.get("acknowledgment_only") is not True:
        missing.append(
            "acknowledgment_only=True (first_campaign is invitation to /campaigns/new, "
            "not a direct Meta-call execution)"
        )
    if missing:
        return _fail(
            "first_campaign_payload_completeness",
            f"first_campaign payload missing/invalid fields: {missing}",
            missing=missing,
        )
    return _pass("first_campaign_payload_completeness")


def _operator_questions_well_formed(prop: dict, state: dict, ctx: dict) -> dict:
    """§46. Phase 0 of Mastery v2 (2026-05-17). If a proposal carries
    `operator_questions`, validate the structure inline so the operator never
    sees a malformed MCQ block in the web UI.

    Rules per question:
      * id: snake_case ASCII, 1-40 chars
      * prompt_he: 1-200 chars
      * options: 2-4 entries, each {value: str (1-64 chars), label_he: str (1-80 chars)}
      * multi / required: optional booleans
    Max 2 questions per proposal (operator fatigue).
    """
    questions = prop.get("operator_questions")
    if questions is None or questions == []:
        return _skip("operator_questions_well_formed", "no operator_questions on proposal")
    if not isinstance(questions, list):
        return _fail(
            "operator_questions_well_formed",
            f"operator_questions must be a list, got {type(questions).__name__}",
        )
    if len(questions) > 2:
        return _fail(
            "operator_questions_well_formed",
            f"max 2 questions per proposal (got {len(questions)}) — operator fatigue rule",
        )
    seen_ids: set[str] = set()
    for i, q in enumerate(questions):
        prefix = f"operator_questions[{i}]"
        if not isinstance(q, dict):
            return _fail("operator_questions_well_formed", f"{prefix} must be a dict")
        qid = q.get("id")
        if not isinstance(qid, str) or not _VALID_QUESTION_ID_RX.match(qid):
            return _fail(
                "operator_questions_well_formed",
                f"{prefix}.id must be snake_case ASCII (1-40 chars), got {qid!r}",
            )
        if qid in seen_ids:
            return _fail("operator_questions_well_formed", f"{prefix}.id={qid!r} duplicated")
        seen_ids.add(qid)
        prompt = q.get("prompt_he")
        if not isinstance(prompt, str) or not (1 <= len(prompt) <= 200):
            return _fail(
                "operator_questions_well_formed",
                f"{prefix}.prompt_he must be 1-200 chars",
            )
        options = q.get("options")
        if not isinstance(options, list) or not (2 <= len(options) <= 4):
            return _fail(
                "operator_questions_well_formed",
                f"{prefix}.options must be 2-4 entries (got {len(options) if isinstance(options, list) else 'non-list'})",
            )
        seen_values: set[str] = set()
        for j, opt in enumerate(options):
            opt_prefix = f"{prefix}.options[{j}]"
            if not isinstance(opt, dict):
                return _fail("operator_questions_well_formed", f"{opt_prefix} must be a dict")
            value = opt.get("value")
            label = opt.get("label_he")
            if not isinstance(value, str) or not (1 <= len(value) <= 64):
                return _fail(
                    "operator_questions_well_formed",
                    f"{opt_prefix}.value must be 1-64 chars",
                )
            if value in seen_values:
                return _fail(
                    "operator_questions_well_formed",
                    f"{opt_prefix}.value={value!r} duplicated within question {qid!r}",
                )
            seen_values.add(value)
            if not isinstance(label, str) or not (1 <= len(label) <= 80):
                return _fail(
                    "operator_questions_well_formed",
                    f"{opt_prefix}.label_he must be 1-80 chars",
                )
        for k in ("multi", "required"):
            if k in q and not isinstance(q[k], bool):
                return _fail(
                    "operator_questions_well_formed",
                    f"{prefix}.{k} must be boolean if present",
                )
    return _pass("operator_questions_well_formed", questions_count=len(questions))


def _cpm_event_no_pause(prop: dict, state: dict, ctx: dict) -> dict:
    """§55. Mastery v2 Phase F. During flagged cpm_event weeks (BFCM IL,
    election windows, security events), don't pause campaigns on a CPM-only
    spike. The spike is structural (consumer-brand auction crush) — pausing
    just hands opportunity to competitors.

    Only refuses pause_campaign/pause_adset when:
      state.cpm_event_active == True
      AND payload.reason in {'cpm_spike', 'cpm_only'} OR rationale mentions
          CPM without falling-CTR / rising-CPL evidence.

    State fields:
      cpm_event_active : bool — output of apply_israeli_calendar.cpm_event
      ctr_trend_pct    : float | None — last-7d vs prior-7d CTR delta
      cpl_trend_pct    : float | None — same
    """
    task = prop.get("task_type")
    if task not in ("pause_campaign", "pause_adset"):
        return _skip("cpm_event_no_pause", "rule applies to pause_* tasks only")
    if not state.get("cpm_event_active"):
        return _skip("cpm_event_no_pause", "no cpm_event window active")
    payload = prop.get("payload") or {}
    reason = (payload.get("reason") or "").lower()
    if "cpm" not in reason and "cpm" not in (prop.get("rationale", "")[:200].lower()):
        return _pass("cpm_event_no_pause", note="pause reason not CPM-only")
    ctr_trend = state.get("ctr_trend_pct")
    cpl_trend = state.get("cpl_trend_pct")
    has_falling_ctr = isinstance(ctr_trend, int | float) and ctr_trend < -15
    has_rising_cpl = isinstance(cpl_trend, int | float) and cpl_trend > 25
    if has_falling_ctr or has_rising_cpl:
        return _pass(
            "cpm_event_no_pause",
            note="CPM spike + secondary degradation — pause justified",
        )
    return _fail(
        "cpm_event_no_pause",
        "CPM spike during flagged cpm_event window (BFCM IL or similar) is "
        "structural — don't pause unless CTR is also falling ≥15% or CPL is "
        "rising ≥25%. The auction crush is temporary; pausing hands inventory "
        "to competitors.",
        ctr_trend_pct=ctr_trend,
        cpl_trend_pct=cpl_trend,
    )


def _boost_post_requires_five_thresholds(prop: dict, state: dict, ctx: dict) -> dict:
    """§53. Mastery v2 Phase E. boost_post must clear all 5 organic-perf
    thresholds before promotion. Each metric value + threshold must appear in
    payload.boost_signals (set by check_organic_performance --boost-candidates)
    so the operator can see the receipts.

    Required signals + thresholds:
      engagement_rate_vs_page_avg ≥ 1.5
      save_rate                   ≥ 0.01 (1% of reach)
      share_rate                  ≥ 0.005 (0.5%)
      reels_watch_through         ≥ 0.25  (only if format=reels)
      comment_thread_depth_count  ≥ 3
    """
    if prop.get("task_type") != "boost_post":
        return _skip("boost_post_requires_five_thresholds", "task_type != boost_post")
    payload = prop.get("payload") or {}
    signals = payload.get("boost_signals") or {}
    if not isinstance(signals, dict):
        return _fail(
            "boost_post_requires_five_thresholds",
            "payload.boost_signals missing or not a dict — call check_organic_performance "
            "--boost-candidates and pass the values through.",
        )
    is_reels = (payload.get("format") or "").lower() in ("reels", "reel")
    checks = [
        ("engagement_rate_vs_page_avg", 1.5),
        ("save_rate", 0.01),
        ("share_rate", 0.005),
        ("comment_thread_depth_count", 3),
    ]
    if is_reels:
        checks.append(("reels_watch_through", 0.25))
    failures: list[dict] = []
    for key, threshold in checks:
        value = signals.get(key)
        if not isinstance(value, int | float) or value < threshold:
            failures.append({"signal": key, "value": value, "threshold": threshold})
    if failures:
        return _fail(
            "boost_post_requires_five_thresholds",
            f"{len(failures)} of {len(checks)} required signal(s) below threshold — "
            f"don't waste paid spend on marginal organic. Propose new_creative instead.",
            failures=failures,
        )
    return _pass(
        "boost_post_requires_five_thresholds",
        signals_checked=len(checks),
    )


def _boost_post_wait_window(prop: dict, state: dict, ctx: dict) -> dict:
    """§54. Mastery v2 Phase E. Block boost_post if post was created less
    than 48h ago. Organic signal needs time to accrue so the boosted ad
    inherits ad-relevance lift + lower CPM. Reading paid traffic on a fresh
    post = paying for cold-creative performance.

    State field: post_created_age_hours : float
    """
    if prop.get("task_type") != "boost_post":
        return _skip("boost_post_wait_window", "task_type != boost_post")
    age_hours = state.get("post_created_age_hours")
    if age_hours is None:
        return _skip("boost_post_wait_window", "post_created_age_hours not in state")
    if age_hours < 48:
        return _fail(
            "boost_post_wait_window",
            f"post is only {age_hours:.0f}h old — wait until ≥48h so organic "
            f"signal accrues first (better ad relevance score, lower CPM).",
            age_hours=age_hours,
            min_age_hours=48,
        )
    if age_hours > 14 * 24:
        return _fail(
            "boost_post_wait_window",
            f"post is {age_hours / 24:.0f}d old — too stale to boost (recency "
            f"signal lost). Promote a fresher winner instead.",
            age_hours=age_hours,
            max_age_hours=14 * 24,
        )
    return _pass("boost_post_wait_window", age_hours=age_hours)


def _prospecting_must_apply_master_exclusion(prop: dict, state: dict, ctx: dict) -> dict:
    """§51. Mastery v2 Phase D. Every new_campaign / expand_audience proposal
    targeting prospecting (cold audience, no retargeting custom_audiences)
    must include the master_exclusion_id in `excluded_custom_audiences`.

    Soft-skip when there's no Master Exclusion built yet (Phase D Pre-step:
    `compute_master_exclusion` must run + reach Meta-min ≥100 records first).
    State field: master_exclusion_audience_id : str | None
    """
    task = prop.get("task_type")
    if task not in ("new_campaign", "expand_audience"):
        return _skip(
            "prospecting_must_apply_master_exclusion",
            "rule applies to new_campaign / expand_audience only",
        )
    master_id = state.get("master_exclusion_audience_id")
    if not master_id:
        return _skip(
            "prospecting_must_apply_master_exclusion",
            "no master_exclusion_audience_id in state — run compute_master_exclusion first",
        )
    payload = prop.get("payload") or {}
    targeting = payload.get("targeting") or {}
    excluded = targeting.get("excluded_custom_audiences") or payload.get("excluded_audience_ids")
    excluded_ids: set[str] = set()
    if isinstance(excluded, list):
        for item in excluded:
            if isinstance(item, dict) and item.get("id"):
                excluded_ids.add(str(item["id"]))
            elif isinstance(item, str):
                excluded_ids.add(item)
    if master_id in excluded_ids:
        return _pass(
            "prospecting_must_apply_master_exclusion",
            master_exclusion_audience_id=master_id,
        )
    return _fail(
        "prospecting_must_apply_master_exclusion",
        f"prospecting proposal must exclude master_exclusion_audience_id={master_id} "
        f"to avoid bidding on existing leads/customers (Wonderful research: -40% CPA). "
        f"Add it to targeting.excluded_custom_audiences.",
        master_exclusion_audience_id=master_id,
    )


def _lal_min_ratio_for_il(prop: dict, state: dict, ctx: dict) -> dict:
    """§52. Mastery v2 Phase D. Israeli Lookalike audiences must have ratio
    ≥0.02 (2%). At 1% on IL seed (any size), the LAL audience is ~65-95K —
    below the 50K floor where Meta delivery quality collapses (CPCs spike
    2-3×). Israeli small-country math demands 2-5%, never 1%.
    """
    if prop.get("task_type") != "create_lookalike":
        return _skip("lal_min_ratio_for_il", "rule applies to create_lookalike only")
    payload = prop.get("payload") or {}
    country = (payload.get("country") or "").upper()
    if country != "IL":
        return _skip("lal_min_ratio_for_il", f"country={country!r}, not IL")
    ratio = payload.get("ratio")
    if not isinstance(ratio, int | float):
        return _fail(
            "lal_min_ratio_for_il",
            f"create_lookalike payload missing valid 'ratio' (got {ratio!r})",
        )
    if ratio < 0.02:
        return _fail(
            "lal_min_ratio_for_il",
            f"IL LAL with ratio={ratio} produces an audience below the 50K delivery floor "
            f"(small-country math: ~6.47M reachable × {ratio} = ~{int(6_470_000 * ratio):,}). "
            f"Use 2-5% — never 1% for Israel.",
            ratio_proposed=ratio,
            min_ratio=0.02,
        )
    return _pass("lal_min_ratio_for_il", ratio=ratio)


def _scale_up_requires_graded_sample(prop: dict, state: dict, ctx: dict) -> dict:
    """§42. Mastery v2 Phase C. Hard-blocks scale_up / budget_change-increase
    on a campaign whose graded_sample_size_14d < 20. Replaces §40's warn-only
    behavior — the 16.4 trap (cheap-Meta CPL with garbage leads) happens
    exactly when the agent scales on raw CPL without enough quality grades
    to know the leads are actually good.

    State fields:
      graded_sample_size_14d : int — count of distinct leads graded in last 14d
                                     for the target campaign
    """
    task = prop.get("task_type")
    payload = prop.get("payload") or {}
    is_scale_up = task == "scale_up"
    is_increase = task == "budget_change" and _is_budget_increase(payload)
    if not (is_scale_up or is_increase):
        return _skip(
            "scale_up_requires_graded_sample",
            "rule applies only to scale_up / budget_change-increase tasks",
        )
    graded = state.get("graded_sample_size_14d")
    if graded is None:
        # Could be a brand-new campaign with no leads yet — different gate.
        return _skip(
            "scale_up_requires_graded_sample",
            "graded_sample_size_14d not in state (Flow A Step 1.5 didn't run?)",
        )
    if graded >= 20:
        return _pass("scale_up_requires_graded_sample", graded_sample_size_14d=graded)
    return _fail(
        "scale_up_requires_graded_sample",
        f"need ≥20 graded leads in last 14 days before scaling (have {graded}). "
        f"The 16.4 trap: raw Meta CPL looks great, lead quality is garbage. "
        f"Grade pending leads in /leads first, then re-propose.",
        graded_sample_size_14d=graded,
        required=20,
    )


def _is_budget_increase(payload: dict) -> bool:
    """Helper: does this budget_change payload represent an increase?"""
    new_b = payload.get("new_daily_budget_cents") or payload.get("new_daily_budget_ils")
    old_b = payload.get("old_daily_budget_cents") or payload.get("old_daily_budget_ils")
    if isinstance(new_b, int | float) and isinstance(old_b, int | float):
        return new_b > old_b
    return False


def _lead_grading_coverage_minimum(prop: dict, state: dict, ctx: dict) -> dict:
    """§45. Mastery v2 Phase C. Surface an alert when grading coverage drops
    below 60% over 30d — the operator needs a nudge to keep grading pending
    leads, otherwise §42 starts blocking everything.

    State fields:
      lead_grading_coverage_30d : float 0..1
    """
    coverage = state.get("lead_grading_coverage_30d")
    if coverage is None:
        return _skip("lead_grading_coverage_minimum", "lead_grading_coverage_30d not in state")
    if coverage >= 0.6:
        return _pass("lead_grading_coverage_minimum", coverage_30d=round(coverage, 3))
    # Don't fail — surface as a soft warning. The agent's job is to notice
    # and emit an alert task; this rule just records the observation.
    return _pass(
        "lead_grading_coverage_minimum",
        warning="coverage_below_60pct",
        coverage_30d=round(coverage, 3),
        suggested_action="emit alert nudging operator to grade pending leads in /leads",
    )


def _eom_no_panic_spend(prop: dict, state: dict, ctx: dict) -> dict:
    """§49. Mastery v2 Phase B. In the last 5 days of the month with severe
    underrun (pace <0.85), refuse scale_up >+15% and refuse new_campaign.
    The right move is to log lost_opportunity to monthly_brief and root-cause
    for next month — never to crash-spend, which jacks CPL 40-100%.

    Reads `state.pace_ratio`, `state.days_left_in_month`. If those aren't
    populated (e.g. compute_monthly_pace didn't run this turn), skip.
    """
    pace_ratio = state.get("pace_ratio")
    days_left = state.get("days_left_in_month")
    if pace_ratio is None or days_left is None:
        return _skip("eom_no_panic_spend", "pace_ratio or days_left_in_month not in state")
    if days_left > 5 or pace_ratio >= 0.85:
        return _pass("eom_no_panic_spend")
    task = prop.get("task_type")
    payload = prop.get("payload") or {}
    if task == "new_campaign":
        return _fail(
            "eom_no_panic_spend",
            f"end-of-month brake: {days_left}d left + pace={pace_ratio:.2f} — "
            f"refuse new_campaign (kicks Learning, won't finish learning before EOM)",
        )
    if task in ("scale_up", "budget_change"):
        new_b = payload.get("new_daily_budget_cents") or payload.get("new_daily_budget_ils")
        old_b = payload.get("old_daily_budget_cents") or payload.get("old_daily_budget_ils")
        if isinstance(new_b, int | float) and isinstance(old_b, int | float) and old_b > 0:
            jump_pct = (new_b - old_b) / old_b * 100
            if jump_pct > 15:
                return _fail(
                    "eom_no_panic_spend",
                    f"end-of-month brake: {days_left}d left + pace={pace_ratio:.2f} — "
                    f"refuse scale_up of +{jump_pct:.0f}% (>15% panic cap). "
                    f"Log lost_opportunity instead.",
                )
    return _pass("eom_no_panic_spend")


def _cold_start_front_load_window(prop: dict, state: dict, ctx: dict) -> dict:
    """§50. Mastery v2 Phase B. In the first 14 days from onboarding_started_at,
    daily budgets up to 150% of pro-rated monthly are LEGITIMATE (Foxwell:
    "faster spend = faster signal"). The pacing router shouldn't flag them as
    overrun, and other guardrails shouldn't refuse new_campaign / scale_up on
    "pace too aggressive" grounds during this window.

    This rule's job: pass-or-skip with a clear signal so callers (router +
    other guardrails) know "cold-start mode active." It doesn't fail — it's
    a positive-signal rule.
    """
    days_since_onboarding = state.get("days_since_onboarding")
    if days_since_onboarding is None:
        return _skip("cold_start_front_load_window", "days_since_onboarding not in state")
    if days_since_onboarding > 14:
        return _pass(
            "cold_start_front_load_window",
            mode="steady_state",
            days_since_onboarding=days_since_onboarding,
        )
    return _pass(
        "cold_start_front_load_window",
        mode="cold_start_active",
        days_since_onboarding=days_since_onboarding,
        max_pro_rated_multiplier=1.5,
        note="front-load up to 150% of pro-rated daily is acceptable",
    )


# Judgment-only: enforced by prompts, not by this tool
JUDGMENT_ONLY_RULES = [
    "meta_api_rate_limit",
    "document_every_decision",
    "require_95pct_significance_for_ab",
    "no_manual_creative_pruning_before_48h",
    "video_preferred_on_equal_cpa",
    # §46.5 — companion to §46. When a proposal descends from an answered
    # approval (inputs.prior_response_ref), the rationale must reference the
    # operator's chosen answer. Can't enforce deterministically (would require
    # cross-DB join + free-text NLP); the agent prompt binds this behavior.
    "respect_operator_response",
    # §48 — Mastery v2 Phase B. Flow A must call route_pacing_action.py as
    # Step 0.7, BEFORE any §T-lane evaluation. The pacing-router output
    # (`recommended_lane`) becomes the prior on task_type selection. Can't
    # enforce here because we only see the proposal, not the run trace.
    "pacing_router_must_run_first",
    # §44 — Mastery v2 Phase C. When raw Meta CPL diverges from quality-
    # adjusted CPL by ≥20%, the rationale paragraph 1 must lead with the
    # quality-adjusted figure (not raw). Judgment-only because it requires
    # reading the rationale narrative + computing divergence in context.
    "quality_adjusted_cpl_leads_report",
]

CHECKS: list[Callable[[dict, dict, dict], dict]] = [
    _no_delete_campaigns,
    _max_tasks_per_day,
    _no_learning_phase_touch,
    _budget_jump_max_30pct,
    _no_audience_change_on_active,
    _no_horizontal_scaling_by_duplication,
    _no_pause_on_recent_conversion_24h,
    _no_low_res_creative,
    _prefer_add_creative_over_pause,
    _no_frequency_only_kill,
    _verify_tracking_infrastructure,
    _enforce_budget_formula,
    _explicit_approval_over_threshold_ils,
    # Block 5 (2026-05-12) — guardrails 19-25
    _no_new_creative_when_underspending,
    _scale_up_cadence_max_1_per_week,
    _marginal_return_check_before_scale_up,
    _scale_down_max_15pct_per_step,
    _no_consecutive_scale_down_14d,
    _no_scale_down_in_learning,
    _respect_hands_off,
    _set_kpi_target_requires_research,
    # Flow D (2026-05-13) — competitive research
    _no_competitor_hallucinations,
    # Block 8 (2026-05-13) — gallery-first sourcing
    _prefer_gallery_over_generation,
    # Block 11 (2026-05-13) — A/B test orchestration
    _ab_test_requires_min_creatives,
    _ab_test_min_window_7d,
    # 2026-05-13 (afternoon) — rationale quality (§§32-34)
    # Added in response to operator frustration: alert proposals lacked clear
    # "אישור = / דחייה =" footers (§32), `acknowledgment_only` flag was missing
    # so the UI couldn't distinguish action proposals from ack alerts (§33),
    # and paragraph 1 of rationale leaked agent jargon like Flow B / AEM /
    # business_knowledge / execute_task.py:225 (§34).
    _rationale_has_approve_reject_footer,
    _alert_requires_acknowledgment_only_flag,
    _rationale_paragraph_1_clean,
    # Phase 1 (Campaigner Mastery Plan, 2026-05-13 evening) — audience rules
    # §§35-36. §35 blocks Lookalike creation off a seed audience that's too
    # small for Meta (upper bound < 100). §36 blocks double-narrowed targeting
    # where the agent stacks a custom_audience_id together with narrow interest
    # targeting — Andromeda prefers broad-with-audience-id over narrowed.
    _audience_size_min_for_lookalike,
    _audience_targeting_not_double_narrowed,
    # 2026-05-13 PM — feedback loop (§37). The agent must read prior rejections
    # before re-proposing the same task on the same target. Context comes from
    # `load_feedback_history.py` via _fetch_context.prior_rejections_60d.
    _respect_prior_rejections,
    # 2026-05-13 PM — §38 new_campaign payload completeness. The operator
    # audited a new_campaign proposal and pointed out it didn't fill the full
    # form. Rule enforces every required field across campaign + ad set + ad.
    _new_campaign_payload_completeness,
    # 2026-05-13 PM — §39 respect_active_plans. Hard-binds the soft cross-run
    # plan memory exposed by load_active_plans. Without §39, the agent could
    # read prior plans and ignore them; with §39, every proposal on a target
    # that has an active plan must either advance the plan or explicitly
    # supersede it.
    _respect_active_plans,
    # 2026-05-13 PM — §41 copy_must_match_brief_voice. Customer-facing copy
    # in new_campaign / new_creative / redeploy_creative payloads must not
    # contain forbidden lexicon (pan-Israeli spam + Aiweon-specific). Pairs
    # with compose_copy_brief.py — same forbidden lists.
    _copy_must_match_brief_voice,
    # Phase 2 (Campaigner Mastery Plan §5, 2026-05-13 evening) — §40
    # winner_requires_quality_grade. The 16.4 lesson encoded:
    # cheap raw CPL/CPM means nothing if leads are spam. Blocks
    # scale_up / budget_change-increase / new_creative / expand_audience
    # on a campaign whose lead quality is low_quality or all_spam.
    _winner_requires_quality_grade,
    # Phase 3 (Campaigner Mastery Plan §6) — §41 campaign_objective_aligned_with_kpi.
    # new_campaign proposals must use an objective that produces signal for the
    # business's primary_kpi. Examples that fail: primary_kpi=cpl with
    # objective=OUTCOME_TRAFFIC (no lead conversions → CPL is unmeasurable);
    # primary_kpi=roas with objective=OUTCOME_AWARENESS (no purchase signal).
    _campaign_objective_aligned_with_kpi,
    # Phase 1 add-on (migration 025, 2026-05-13) — §42 geo_targeting_set_for_new_campaign.
    # Soft warning (not block): if a `new_campaign` is proposed for a business
    # whose `business_knowledge.geo_targeting` is null/empty, surface a warning
    # so the operator notices the campaign will inherit "all of Israel" by
    # default — exactly the spend-spread Roi flagged on 2026-05-13.
    _geo_targeting_set_for_new_campaign,
    # Mastery v2 Phase 0 (2026-05-17) — §46 operator_questions_well_formed.
    # If the proposal carries inline MCQ questions for the operator, validate
    # them structurally before they land in the approvals UI. Companion
    # judgment-only rule §46.5 `respect_operator_response` binds the agent to
    # read prior answers when re-proposing from an `answered` approval.
    _operator_questions_well_formed,
    # Mastery v2 Phase A (Onboarding Flow F, 2026-05-17) — §47
    # first_campaign_payload_completeness. The first_campaign proposal lands at
    # step 4 of the onboarding chain and is the operator's "wow" moment. It
    # MUST include: service_tag (or null if business has only one service),
    # recommended_daily_budget_ils > 0, objective_recommendation in the valid
    # enum, audience_summary_he non-empty, and acknowledgment_only=True (the
    # actual Meta campaign is created via /campaigns/new, not via execute_task).
    _first_campaign_payload_completeness,
    # Mastery v2 Phase B (Budget Pacing Router, 2026-05-17) — §49 + §50.
    # §49 blocks panic-spend in the last 5 days when underrun. §50 is a
    # positive-signal rule that announces "cold-start mode active" so other
    # guardrails don't false-positive on aggressive day-1 spend.
    _eom_no_panic_spend,
    _cold_start_front_load_window,
    # Mastery v2 Phase C (Lead Quality wire-in, 2026-05-17) — §42 + §45.
    # §42 hard-blocks scale_up on campaigns with <20 graded leads in last 14d
    # (the structural fix to the 16.4 trap — previous §40 only warned).
    # §45 surfaces an alert when grading coverage falls below 60% over 30d
    # so the operator gets nudged to grade pending leads.
    _scale_up_requires_graded_sample,
    _lead_grading_coverage_minimum,
    # Mastery v2 Phase D (Audience Monthly Review + free-text, 2026-05-17).
    # §51 enforces master_exclusion on every prospecting ad set (Wonderful's
    # -40% CPA finding). §52 blocks Israeli LAL with ratio <2% — small-country
    # math: 1% LAL of any IL seed = ~65-95K users, below the 50K delivery
    # collapse floor.
    _prospecting_must_apply_master_exclusion,
    _lal_min_ratio_for_il,
    # Mastery v2 Phase E (Organic Cadence + boost_post triggers, 2026-05-17).
    # §53 enforces the 5-threshold gate (engagement ≥1.5× page avg, save ≥1%,
    # share ≥0.5%, Reels watch ≥25%, ≥3 multi-reply threads) before any
    # boost_post proposal — closes the "marginal organic gets boosted" trap.
    # §54 enforces the 48h wait window (let organic signal accrue first so
    # the boost inherits trust + lower CPM).
    _boost_post_requires_five_thresholds,
    _boost_post_wait_window,
    # Mastery v2 Phase F (Israeli Calendar, 2026-05-17). §55 disables pause-
    # on-CPM-spike during flagged cpm_event weeks (BFCM IL, etc.) — the
    # spike is structural (consumer-brand auction crush), not a campaign
    # problem. Pausing would just hand opportunity to competitors.
    _cpm_event_no_pause,
]


# ----------------------------------------------------------- context fetch


def _fetch_context(
    business_id: str,
    target_id: str | None = None,
    proposal_channel: str | None = None,
    proposal_task_type: str | None = None,
    proposal_target_kind: str | None = None,
) -> dict:
    """Fetch counters / thresholds check_guardrails needs from DB.

    Block 5 (2026-05-12) additions:
      - `scale_ups_last_7d_on_target` — count of executed scale_up/budget_change
        approvals on the same target_id in last 7 days (for §20 cadence cap).
      - `scale_downs_last_14d_on_target` — count of executed scale_down approvals
        on the same target_id in last 14 days (for §23 consecutive-down rule).

    Block 8 (2026-05-13) additions:
      - `viable_unused_gallery_count_for_channel` — count of creative_gallery
        rows that are deployable (storage_url present, not soft-deleted, not
        already a creative behind an executed ad approval) AND match the
        channel's aspect ratios. Used by §28 prefer_gallery_over_generation.
    """
    ctx: dict[str, Any] = {}
    biz = fetch_one(
        "SELECT daily_budget_ils, primary_kpi FROM businesses WHERE id = %s",
        (business_id,),
    )
    if biz:
        daily_budget = biz.get("daily_budget_ils") or 0
        # §8.3 anti-flood cap tiers
        if daily_budget < 50:
            ctx["daily_task_cap"] = 2
        elif daily_budget <= 500:
            ctx["daily_task_cap"] = 5
        else:
            ctx["daily_task_cap"] = 10
        # §41 input — primary_kpi.
        if biz.get("primary_kpi"):
            ctx["primary_kpi"] = biz["primary_kpi"]

    count_row = fetch_one(
        "SELECT COUNT(*) AS n FROM approvals WHERE business_id = %s "
        "AND created_at::date = now()::date",
        (business_id,),
    )
    ctx["pending_today_count"] = (count_row or {}).get("n", 0) or 0

    if target_id:
        scale_up_row = fetch_one(
            """
            SELECT COUNT(*) AS n FROM approvals
             WHERE business_id = %s
               AND target_id = %s
               AND task_type IN ('scale_up','budget_change')
               AND status = 'executed'
               AND executed_at IS NOT NULL
               AND executed_at >= now() - interval '7 days'
            """,
            (business_id, target_id),
        )
        ctx["scale_ups_last_7d_on_target"] = (scale_up_row or {}).get("n", 0) or 0

        scale_down_row = fetch_one(
            """
            SELECT COUNT(*) AS n FROM approvals
             WHERE business_id = %s
               AND target_id = %s
               AND task_type = 'scale_down'
               AND status = 'executed'
               AND executed_at IS NOT NULL
               AND executed_at >= now() - interval '14 days'
            """,
            (business_id, target_id),
        )
        ctx["scale_downs_last_14d_on_target"] = (scale_down_row or {}).get("n", 0) or 0

    # Block 8 (2026-05-13): gallery census for §28
    # prefer_gallery_over_generation. Mirror the SQL of
    # `list_active_creatives --unused-in-campaigns --matches-channel`.
    # When proposal_channel is None we skip the query — §28 then returns
    # `_skip` with a "caller must run list_active_creatives first" reason.
    if proposal_channel is not None:
        CHANNEL_ASPECTS = {
            "feed": ["1:1", "4:5"],
            "stories": ["9:16"],
            "reels": ["9:16"],
        }
        aspects = CHANNEL_ASPECTS.get(proposal_channel)
        if aspects is not None:
            video_clause = " AND kind = 'video'" if proposal_channel == "reels" else ""
            viable_row = fetch_one(
                f"""
                SELECT COUNT(*) AS n
                  FROM creative_gallery
                 WHERE business_id = %s
                   AND deleted_at IS NULL
                   AND storage_url IS NOT NULL
                   AND aspect_ratio = ANY(%s)
                   {video_clause}
                   AND (
                     meta_creative_id IS NULL
                     OR meta_creative_id NOT IN (
                       SELECT (execution_result->>'creative_id')
                         FROM approvals
                        WHERE business_id = %s
                          AND status = 'executed'
                          AND task_type IN ('new_creative','redeploy_creative','boost_post','new_campaign')
                          AND execution_result IS NOT NULL
                          AND execution_result->>'creative_id' IS NOT NULL
                     )
                   )
                """,
                (business_id, aspects, business_id),
            )
            ctx["viable_unused_gallery_count_for_channel"] = (viable_row or {}).get("n", 0) or 0
            ctx["proposal_channel"] = proposal_channel

    # §37 prior_rejections_60d — feed _respect_prior_rejections (2026-05-13 PM).
    # Mirror the bulk-reason filter from load_feedback_history.py so the guardrail
    # only sees meaningful rejections, not system housekeeping.
    if proposal_task_type and target_id:
        prior_rejections = fetch_all(
            """
            SELECT id, rejection_reason, created_at, target_kind, target_id
              FROM approvals
             WHERE business_id = %s
               AND status = 'rejected'
               AND task_type = %s
               AND target_id = %s
               AND created_at > now() - interval '60 days'
               AND rejection_reason IS NOT NULL
               AND length(rejection_reason) > 8
               AND rejection_reason NOT LIKE 'reset_per_operator_request%%'
               AND rejection_reason NOT LIKE 'anti_flood%%'
               AND rejection_reason NOT LIKE 'tracking_unhealthy_proposal_already_pending%%'
               AND rejection_reason NOT LIKE 'expired_no_action%%'
               AND rejection_reason NOT LIKE 'superseded_by_run_%%'
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (business_id, proposal_task_type, target_id),
        )
        ctx["prior_rejections_60d"] = [
            {
                "approval_id": str(r["id"]),
                "rejection_reason": (r["rejection_reason"] or "").strip()[:200],
                "rejected_on": r["created_at"].date().isoformat() if r.get("created_at") else None,
            }
            for r in (prior_rejections or [])
        ]
    elif proposal_task_type and not target_id:
        # Account-level proposals (target_id is None) — match on task_type only.
        prior_rejections = fetch_all(
            """
            SELECT id, rejection_reason, created_at
              FROM approvals
             WHERE business_id = %s
               AND status = 'rejected'
               AND task_type = %s
               AND target_id IS NULL
               AND created_at > now() - interval '60 days'
               AND rejection_reason IS NOT NULL
               AND length(rejection_reason) > 8
               AND rejection_reason NOT LIKE 'reset_per_operator_request%%'
               AND rejection_reason NOT LIKE 'anti_flood%%'
               AND rejection_reason NOT LIKE 'tracking_unhealthy_proposal_already_pending%%'
               AND rejection_reason NOT LIKE 'expired_no_action%%'
               AND rejection_reason NOT LIKE 'superseded_by_run_%%'
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (business_id, proposal_task_type),
        )
        ctx["prior_rejections_60d"] = [
            {
                "approval_id": str(r["id"]),
                "rejection_reason": (r["rejection_reason"] or "").strip()[:200],
                "rejected_on": r["created_at"].date().isoformat() if r.get("created_at") else None,
            }
            for r in (prior_rejections or [])
        ]

    # Phase 2 (Campaigner Mastery Plan §5) — lead quality summary for §40.
    # Looks up the per-campaign latest-grade aggregate when the proposal targets
    # a campaign. The 14-day window matches the §40 guardrail and the master
    # plan's "winner requires quality" rule.
    if target_id and proposal_target_kind in ("campaign", "adset"):
        # adset proposals: resolve adset → campaign via leads.meta_adset_id link
        cid_for_quality = target_id if proposal_target_kind == "campaign" else None
        if cid_for_quality is None:
            adset_row = fetch_one(
                "SELECT DISTINCT meta_campaign_id FROM leads "
                "WHERE business_id = %s AND meta_adset_id = %s LIMIT 1",
                (business_id, target_id),
            )
            cid_for_quality = (adset_row or {}).get("meta_campaign_id")
        if cid_for_quality:
            q_row = fetch_one(
                """
                WITH window_leads AS (
                  SELECT l.id
                    FROM leads l
                   WHERE l.business_id = %s
                     AND l.meta_campaign_id = %s
                     AND l.archived_at IS NULL
                     AND (
                       l.meta_created_at >= now() - interval '14 days'
                       OR l.meta_created_at IS NULL
                     )
                )
                SELECT
                  (SELECT COUNT(*) FROM window_leads) AS leads_total,
                  (SELECT COUNT(*) FROM window_leads wl
                     JOIN lead_latest_grade g ON g.lead_id = wl.id) AS leads_graded,
                  (SELECT AVG(g.grade)::float FROM window_leads wl
                     JOIN lead_latest_grade g ON g.lead_id = wl.id) AS avg_grade,
                  (SELECT SUM(CASE g.grade
                                 WHEN 1 THEN 0.00
                                 WHEN 2 THEN 0.25
                                 WHEN 3 THEN 0.50
                                 WHEN 4 THEN 1.00
                                 WHEN 5 THEN 1.50
                                 ELSE 0 END)::float
                     FROM window_leads wl
                     JOIN lead_latest_grade g ON g.lead_id = wl.id) AS weighted_sum
                """,
                (business_id, cid_for_quality),
            )
            if q_row:
                leads_total = int(q_row.get("leads_total") or 0)
                leads_graded = int(q_row.get("leads_graded") or 0)
                avg_grade = q_row.get("avg_grade")
                weighted = float(q_row.get("weighted_sum") or 0)
                effective = weighted + (leads_total - leads_graded) * 0.5
                effective_ratio = effective / leads_total if leads_total > 0 else None
                if leads_total == 0:
                    status = "no_leads"
                elif effective == 0:
                    status = "all_spam"
                elif leads_graded < 5:
                    status = "insufficient_grades"
                elif effective_ratio is not None and effective_ratio >= 0.7:
                    status = "high_quality"
                elif effective_ratio is not None and effective_ratio >= 0.4:
                    status = "mixed_quality"
                else:
                    status = "low_quality"
                ctx["lead_quality_status"] = status
                ctx["lead_quality_leads_total"] = leads_total
                ctx["lead_quality_leads_graded"] = leads_graded
                ctx["lead_quality_avg_grade"] = (
                    round(avg_grade, 2) if avg_grade is not None else None
                )
                ctx["lead_quality_effective_ratio"] = (
                    round(effective_ratio, 2) if effective_ratio is not None else None
                )

    # §39 active_plans_for_target — feed _respect_active_plans (2026-05-13 PM).
    # Phase 1 (DB-first, migration 023): read plans_carryover for hard rows.
    # Phase 2 (regex fallback): also run the inline rationale extractor for
    # any pre-migration approvals that haven't been persisted yet.
    if target_id:
        active_plans: list[dict] = []
        try:
            carry_rows = fetch_all(
                """
                SELECT id, source_approval_id, step_order, action_text,
                       trigger_condition, committed_at
                  FROM plans_carryover
                 WHERE business_id = %s
                   AND target_id = %s
                   AND status = 'pending'
                   AND expires_at > now()
                 ORDER BY committed_at DESC, step_order ASC
                """,
                (business_id, target_id),
            )
            for pr in carry_rows or []:
                active_plans.append(
                    {
                        "plan_id": str(pr["id"]),
                        "source_approval_id": str(pr["source_approval_id"])
                        if pr.get("source_approval_id")
                        else None,
                        "step_order": pr["step_order"],
                        "action_text": pr["action_text"],
                        "trigger_condition": pr.get("trigger_condition"),
                        "committed_on": pr["committed_at"].date().isoformat()
                        if pr.get("committed_at")
                        else None,
                        "source": "plans_carryover",
                    }
                )
        except Exception:
            # plans_carryover table not present (pre-migration env). Continue
            # with regex fallback only.
            pass
        plan_rows = fetch_all(
            """
            SELECT id, rationale, approved_at, executed_at, status
              FROM approvals
             WHERE business_id = %s
               AND status IN ('approved', 'executed')
               AND target_id = %s
               AND coalesce(executed_at, approved_at) > now() - interval '21 days'
               AND id NOT IN (
                 SELECT source_approval_id FROM plans_carryover
                  WHERE business_id = %s AND source_approval_id IS NOT NULL
               )
             ORDER BY coalesce(executed_at, approved_at) DESC
             LIMIT 5
            """,
            (business_id, target_id, business_id),
        )
        plan_header_rx = re.compile(r"(?:\*\*)?תוכנית(?:\*\*)?\s*[:：]\s*")
        footer_rx = re.compile(r"\n\s*אישור\s*[=—:]")
        step_rx = re.compile(
            r"^\s*(?:(\d+)\s*[\.\):\-]|[•●▪\-])\s*(.+?)\s*$",
            re.MULTILINE,
        )
        for r in plan_rows or []:
            rationale = r.get("rationale") or ""
            m = plan_header_rx.search(rationale)
            if not m:
                continue
            after = rationale[m.end() :]
            footer_m = footer_rx.search(after)
            block = after[: footer_m.start()] if footer_m else after
            steps: list[str] = []
            for sm in step_rx.finditer(block):
                t = sm.group(2).strip()
                t = re.sub(r"\*+$", "", t).strip()
                if t and len(t) > 4:
                    steps.append(t)
                if len(steps) >= 5:
                    break
            forward = steps[1:] if len(steps) > 1 else []
            if not forward:
                continue
            committed = r.get("executed_at") or r.get("approved_at")
            active_plans.append(
                {
                    "approval_id": str(r["id"]),
                    "committed_on": committed.date().isoformat() if committed else None,
                    "forward_steps": forward,
                }
            )
        ctx["active_plans_for_target"] = active_plans

    return ctx


# -------------------------------------------------------------------- main


def main() -> None:
    p = argparse.ArgumentParser(description="Check a proposal against §14 guardrails.")
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--proposal",
        required=True,
        help="JSON object (same shape as propose_task --payload + metadata)",
    )
    p.add_argument(
        "--state", default=None, help="JSON object of live state (learning_status, hook_rate, ...)"
    )
    args = p.parse_args()

    proposal = parse_json_arg(args.proposal, "proposal")
    if not isinstance(proposal, dict):
        emit_validation_error("--proposal must be a JSON object")
        return
    state = parse_json_arg(args.state, "state") or {}
    if not isinstance(state, dict):
        emit_validation_error("--state must be a JSON object")
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Block 8 (2026-05-13): if the proposal is `new_creative` and its payload
    # declares a `channel`, fetch the unused-gallery count for that channel so
    # §28 prefer_gallery_over_generation can evaluate. Otherwise the rule
    # returns _skip.
    payload = proposal.get("payload") or {}
    proposal_channel = payload.get("channel") if isinstance(payload, dict) else None

    try:
        ctx = with_db_retry(
            lambda: _fetch_context(
                args.business_id,
                proposal.get("target_id"),
                proposal_channel=proposal_channel,
                proposal_task_type=proposal.get("task_type"),
                proposal_target_kind=proposal.get("target_kind"),
            )
        )
    except Exception as e:
        emit_runtime_error(f"guardrail context fetch failed: {e}", exc=e)
        return

    results = [fn(proposal, state, ctx) for fn in CHECKS]
    violations = [r for r in results if not r.get("passed")]
    passed = len(violations) == 0

    emit_success(
        {
            "business_id": args.business_id,
            "proposal_task_type": proposal.get("task_type"),
            "passed": passed,
            "violations": violations,
            "checks": results,
            "judgment_only_rules": JUDGMENT_ONLY_RULES,
            "context": ctx,
        }
    )


if __name__ == "__main__":
    main()
