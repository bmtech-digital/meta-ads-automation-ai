"""
Unit tests for guardrails 19-25 added 2026-05-12 in Block 5.

Each guardrail check is a pure function `(prop, state, ctx) -> dict`. These
tests exercise the matrix of (task_type, state, ctx) → (passed | failed |
skipped) without DB or Meta — fast, deterministic, ship-confidence.

Importing `check_guardrails` requires psycopg on the path, which is provided
in the Docker test container per tests/CLAUDE.md. Run via:
  docker compose run --rm campaigner python -m pytest tests/tools/test_guardrails_block5.py -v
"""

from __future__ import annotations

from campaigner.tools.check_guardrails import (
    _marginal_return_check_before_scale_up,
    _no_competitor_hallucinations,
    _no_consecutive_scale_down_14d,
    _no_new_creative_when_underspending,
    _no_scale_down_in_learning,
    _respect_hands_off,
    _scale_down_max_15pct_per_step,
    _scale_up_cadence_max_1_per_week,
    _set_kpi_target_requires_research,
)


def _well_formed_research_payload() -> dict:
    """A complete research block that should pass every check — variants in
    individual tests below mutate one field at a time to isolate failures."""
    return {
        "kpi": "cpl",
        "value": 250,
        "research": {
            "market_average": 240,
            "range_low": 150,
            "range_high": 400,
            "currency": "ILS",
            "sources": [
                {
                    "title": "B2B SaaS CPL benchmark IL 2026",
                    "url": "https://example.com/saas-il-2026",
                    "extracted": "median CPL ₪220 across 38 IL SaaS advertisers",
                },
                {
                    "title": "Meta lead ads platform vertical",
                    "url": "https://example.com/meta-platform",
                    "extracted": "platform demo leads ₪180-380 typical band",
                },
            ],
            "context_used": ["vertical=b2b_saas", "products=influencer_platform"],
            "researched_at": "2026-05-12T09:00:00Z",
        },
        "plan": "Step 1...",
    }


# -------------------------- §19 no_new_creative_when_underspending


def test_no_new_creative_when_underspending_pass_other_task():
    r = _no_new_creative_when_underspending(
        {"task_type": "scale_up"}, {}, {}
    )
    assert r["passed"] is True


def test_no_new_creative_when_underspending_skip_when_util_missing():
    r = _no_new_creative_when_underspending(
        {"task_type": "new_creative"}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


def test_no_new_creative_when_underspending_fail_below_50pct():
    r = _no_new_creative_when_underspending(
        {"task_type": "new_creative"}, {"utilization_7d": 0.42}, {}
    )
    assert r["passed"] is False
    assert "42" in r["reason"]


def test_no_new_creative_when_underspending_pass_at_threshold():
    r = _no_new_creative_when_underspending(
        {"task_type": "new_creative"}, {"utilization_7d": 0.50}, {}
    )
    assert r["passed"] is True


def test_no_new_creative_when_underspending_explicit_override():
    r = _no_new_creative_when_underspending(
        {
            "task_type": "new_creative",
            "payload": {"override_no_new_creative_when_underspending": True},
        },
        {"utilization_7d": 0.10},
        {},
    )
    assert r["passed"] is True


# -------------------------- §20 scale_up_cadence_max_1_per_week


def test_scale_up_cadence_pass_other_task():
    r = _scale_up_cadence_max_1_per_week(
        {"task_type": "pause_campaign"}, {}, {}
    )
    assert r["passed"] is True


def test_scale_up_cadence_skip_when_no_target():
    r = _scale_up_cadence_max_1_per_week(
        {"task_type": "scale_up", "payload": {}}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


def test_scale_up_cadence_fail_when_recent_scale_up():
    r = _scale_up_cadence_max_1_per_week(
        {
            "task_type": "scale_up",
            "target_id": "campaign_123",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 120,
            },
        },
        {},
        {"scale_ups_last_7d_on_target": 1},
    )
    assert r["passed"] is False


def test_scale_up_cadence_pass_when_clean():
    r = _scale_up_cadence_max_1_per_week(
        {
            "task_type": "scale_up",
            "target_id": "campaign_123",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 120,
            },
        },
        {},
        {"scale_ups_last_7d_on_target": 0},
    )
    assert r["passed"] is True


def test_scale_up_cadence_pass_when_budget_change_is_decrease():
    """budget_change with new < old is a scale_down in disguise — cadence
    rule for scale-up doesn't apply."""
    r = _scale_up_cadence_max_1_per_week(
        {
            "task_type": "budget_change",
            "target_id": "campaign_123",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 80,
            },
        },
        {},
        {"scale_ups_last_7d_on_target": 1},
    )
    assert r["passed"] is True


# -------------------------- §21 marginal_return_check_before_scale_up


def test_marginal_return_pass_other_task():
    r = _marginal_return_check_before_scale_up(
        {"task_type": "pause_campaign"}, {}, {}
    )
    assert r["passed"] is True


def test_marginal_return_skip_when_state_missing():
    r = _marginal_return_check_before_scale_up(
        {
            "task_type": "scale_up",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 120,
            },
        },
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


def test_marginal_return_fail_when_prior_didnt_lift():
    r = _marginal_return_check_before_scale_up(
        {
            "task_type": "scale_up",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 120,
            },
        },
        {"marginal_return_passed": False},
        {},
    )
    assert r["passed"] is False
    assert "10%" in r["reason"]


def test_marginal_return_pass_when_prior_lifted():
    r = _marginal_return_check_before_scale_up(
        {
            "task_type": "scale_up",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 120,
            },
        },
        {"marginal_return_passed": True},
        {},
    )
    assert r["passed"] is True


# -------------------------- §22 scale_down_max_15pct_per_step


def test_scale_down_max_pass_at_15pct():
    r = _scale_down_max_15pct_per_step(
        {
            "task_type": "scale_down",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 85,
            },
        },
        {},
        {},
    )
    assert r["passed"] is True
    assert r["drop_pct"] == 15.0


def test_scale_down_max_fail_at_20pct():
    r = _scale_down_max_15pct_per_step(
        {
            "task_type": "scale_down",
            "payload": {
                "old_daily_budget_ils": 100,
                "new_daily_budget_ils": 80,
            },
        },
        {},
        {},
    )
    assert r["passed"] is False
    assert "20" in r["reason"]


def test_scale_down_max_pass_other_task():
    r = _scale_down_max_15pct_per_step(
        {"task_type": "scale_up", "payload": {}}, {}, {}
    )
    assert r["passed"] is True


# -------------------------- §23 no_consecutive_scale_down_14d


def test_no_consecutive_scale_down_pass_when_clean():
    r = _no_consecutive_scale_down_14d(
        {"task_type": "scale_down", "target_id": "c1"},
        {},
        {"scale_downs_last_14d_on_target": 0},
    )
    assert r["passed"] is True


def test_no_consecutive_scale_down_fail_when_prior_exists():
    r = _no_consecutive_scale_down_14d(
        {"task_type": "scale_down", "target_id": "c1"},
        {},
        {"scale_downs_last_14d_on_target": 1},
    )
    assert r["passed"] is False


def test_no_consecutive_scale_down_pass_other_task():
    r = _no_consecutive_scale_down_14d(
        {"task_type": "pause_campaign", "target_id": "c1"},
        {},
        {"scale_downs_last_14d_on_target": 1},
    )
    assert r["passed"] is True


# -------------------------- §24 no_scale_down_in_learning


def test_no_scale_down_in_learning_fail_LEARNING():
    r = _no_scale_down_in_learning(
        {"task_type": "scale_down"},
        {"learning_status": "LEARNING"},
        {},
    )
    assert r["passed"] is False


def test_no_scale_down_in_learning_fail_LEARNING_LIMITED():
    r = _no_scale_down_in_learning(
        {"task_type": "scale_down"},
        {"learning_status": "LEARNING_LIMITED"},
        {},
    )
    assert r["passed"] is False


def test_no_scale_down_in_learning_pass_ACTIVE():
    r = _no_scale_down_in_learning(
        {"task_type": "scale_down"},
        {"learning_status": "ACTIVE"},
        {},
    )
    assert r["passed"] is True


def test_no_scale_down_in_learning_pass_other_task():
    r = _no_scale_down_in_learning(
        {"task_type": "scale_up"},
        {"learning_status": "LEARNING"},
        {},
    )
    assert r["passed"] is True


# -------------------------- §25 respect_hands_off


def test_respect_hands_off_pass_alert():
    """alert is always allowed — informational only."""
    r = _respect_hands_off(
        {"task_type": "alert", "target_id": "c1"},
        {
            "hands_off_campaign_ids": ["c1"],
            "hands_off_brief_is_current": True,
        },
        {},
    )
    assert r["passed"] is True


def test_respect_hands_off_fail_in_hands_off_list():
    r = _respect_hands_off(
        {"task_type": "scale_up", "target_id": "c1"},
        {
            "hands_off_campaign_ids": ["c1", "c2"],
            "hands_off_brief_is_current": True,
        },
        {},
    )
    assert r["passed"] is False


def test_respect_hands_off_pass_not_in_list():
    r = _respect_hands_off(
        {"task_type": "scale_up", "target_id": "c3"},
        {
            "hands_off_campaign_ids": ["c1", "c2"],
            "hands_off_brief_is_current": True,
        },
        {},
    )
    assert r["passed"] is True


def test_respect_hands_off_pass_when_brief_stale():
    """Stale brief = hands_off list is ignored until refreshed."""
    r = _respect_hands_off(
        {"task_type": "scale_up", "target_id": "c1"},
        {
            "hands_off_campaign_ids": ["c1"],
            "hands_off_brief_is_current": False,
        },
        {},
    )
    assert r["passed"] is True


def test_respect_hands_off_emergency_cpa_override():
    """CPA > 3× target overrides hands_off."""
    r = _respect_hands_off(
        {"task_type": "pause_campaign", "target_id": "c1"},
        {
            "hands_off_campaign_ids": ["c1"],
            "hands_off_brief_is_current": True,
            "cpa_ils": 400,
            "target_cpa_ils": 100,
        },
        {},
    )
    assert r["passed"] is True


def test_respect_hands_off_skip_when_no_brief():
    r = _respect_hands_off(
        {"task_type": "scale_up", "target_id": "c1"},
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


# -------------------------- §26 set_kpi_target_requires_research


def test_set_kpi_target_research_pass_other_task():
    r = _set_kpi_target_requires_research(
        {"task_type": "scale_up", "payload": {}}, {}, {}
    )
    assert r["passed"] is True


def test_set_kpi_target_research_fail_when_research_missing():
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": {"kpi": "cpl", "value": 250}},
        {},
        {},
    )
    assert r["passed"] is False
    assert "research missing" in r["reason"]


def test_set_kpi_target_research_fail_when_market_average_missing():
    payload = _well_formed_research_payload()
    del payload["research"]["market_average"]
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "market_average" in r["reason"]


def test_set_kpi_target_research_fail_when_sources_empty():
    payload = _well_formed_research_payload()
    payload["research"]["sources"] = []
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "sources" in r["reason"]


def test_set_kpi_target_research_fail_when_single_source():
    payload = _well_formed_research_payload()
    payload["research"]["sources"] = payload["research"]["sources"][:1]
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "≥2" in r["reason"]


def test_set_kpi_target_research_fail_when_source_missing_url():
    payload = _well_formed_research_payload()
    payload["research"]["sources"][0] = {
        "title": "x",
        "extracted": "y",
    }  # url missing
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "url" in r["reason"]


def test_set_kpi_target_research_fail_when_context_used_empty():
    payload = _well_formed_research_payload()
    payload["research"]["context_used"] = []
    r = _set_kpi_target_requires_research(
        {"task_type": "set_kpi_target", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "context_used" in r["reason"]


def test_set_kpi_target_research_pass_when_fully_formed():
    r = _set_kpi_target_requires_research(
        {
            "task_type": "set_kpi_target",
            "payload": _well_formed_research_payload(),
        },
        {},
        {},
    )
    assert r["passed"] is True
    assert r["sources_count"] == 2


# -------------------------- §27 no_competitor_hallucinations


def _well_formed_competitive_alert_payload(alert_type: str = "trending_angle") -> dict:
    """A complete competitive alert payload for testing — variants in
    individual tests mutate one field at a time."""
    return {
        "alert_type": alert_type,
        "message": "Hebrew message about a market finding",
        "next_steps": ["step 1"],
        "research": {
            "lane": "trending_angle",
            "queries_run": ["trending Meta ads B2B SaaS Israel 2026"],
            "sources": [
                {
                    "title": "IL B2B marketing trends 2026",
                    "url": "https://example.com/trends",
                    "extracted": "ROI calculators emerging as hook in B2B SaaS",
                },
                {
                    "title": "Meta Q1 2026 platform brief",
                    "url": "https://example.com/q1-brief",
                    "extracted": "platform demo ads with quantified outcome lead in 2026",
                },
            ],
            "context_used": ["vertical=b2b_saas", "products=influencer_platform"],
            "researched_at": "2026-05-13T11:00:00Z",
        },
    }


def test_no_competitor_hallucinations_pass_other_task():
    r = _no_competitor_hallucinations(
        {"task_type": "scale_up", "payload": {}}, {}, {}
    )
    assert r["passed"] is True


def test_no_competitor_hallucinations_pass_non_competitive_alert():
    """alert_type='budget_overrun' is not a competitive claim — rule doesn't apply."""
    r = _no_competitor_hallucinations(
        {
            "task_type": "alert",
            "payload": {"alert_type": "budget_overrun", "message": "..."},
        },
        {},
        {},
    )
    assert r["passed"] is True


def test_no_competitor_hallucinations_fail_when_research_missing():
    r = _no_competitor_hallucinations(
        {
            "task_type": "alert",
            "payload": {"alert_type": "trending_angle", "message": "..."},
        },
        {},
        {},
    )
    assert r["passed"] is False
    assert "research" in r["reason"]


def test_no_competitor_hallucinations_fail_when_single_source():
    payload = _well_formed_competitive_alert_payload()
    payload["research"]["sources"] = payload["research"]["sources"][:1]
    r = _no_competitor_hallucinations(
        {"task_type": "alert", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "≥2" in r["reason"]


def test_no_competitor_hallucinations_fail_when_source_missing_url():
    payload = _well_formed_competitive_alert_payload()
    payload["research"]["sources"][0] = {"title": "x", "extracted": "y"}
    r = _no_competitor_hallucinations(
        {"task_type": "alert", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "url" in r["reason"]


def test_no_competitor_hallucinations_fail_when_context_used_empty():
    payload = _well_formed_competitive_alert_payload()
    payload["research"]["context_used"] = []
    r = _no_competitor_hallucinations(
        {"task_type": "alert", "payload": payload}, {}, {}
    )
    assert r["passed"] is False
    assert "context_used" in r["reason"]


def test_no_competitor_hallucinations_pass_for_each_competitive_alert_type():
    for alert_type in ("target_drift", "trending_angle", "new_format"):
        payload = _well_formed_competitive_alert_payload(alert_type=alert_type)
        r = _no_competitor_hallucinations(
            {"task_type": "alert", "payload": payload}, {}, {}
        )
        assert r["passed"] is True, f"alert_type={alert_type} should pass: {r}"
        assert r["alert_type"] == alert_type


def test_no_competitor_hallucinations_pass_for_competitive_prefix():
    """alert_type='competitive_*' (future variant naming) also triggers the rule."""
    payload = _well_formed_competitive_alert_payload(
        alert_type="competitive_pricing_shift"
    )
    r = _no_competitor_hallucinations(
        {"task_type": "alert", "payload": payload}, {}, {}
    )
    assert r["passed"] is True
