"""
Unit tests for `campaigner.lib.capabilities` — the deterministic premise
check that decides which capabilities the agent may *act* on this run.

Pure function: no DB, no Meta, no LLM. Tests pass synthetic state dicts
shaped like what the upstream tools (check_tracking_health, check_account_health,
load_business_knowledge, etc.) return.

Background: docs/todos/capability-gated-decision-flow.md. The whole point
of pulling this logic out of the LLM prompt is to make it testable —
that's what these tests exercise.
"""

from __future__ import annotations

from campaigner.lib.capabilities import (
    Capability,
    CapabilityReport,
    compute_capabilities,
)


# ---- helpers ----------------------------------------------------------------


def _healthy_state() -> dict:
    """Baseline state where every capability is exercisable. Subsequent
    tests mutate one field at a time to assert the expected gate fires."""
    return {
        "tracking_health": {"status": "healthy", "blocks_proposals": []},
        "account_health": {"health_band": "healthy"},
        "business": {
            "id": "biz-1",
            "primary_kpi": "cpl",
            "target_cpa_ils": None,
            "target_cpl_ils": 80.0,
            "target_roas": None,
        },
        "kpi_research": {
            "sources": [
                {"title": "x", "url": "y", "extracted": "z"},
                {"title": "a", "url": "b", "extracted": "c"},
            ],
            "matched_terms": ["סוכן AI"],
        },
        "campaign_state": {
            "utilization_7d": 0.85,
            "in_learning": False,
            "ab_test_age_days": 14,
            "cpa_vs_target_ratio": 1.3,
        },
    }


def _names_available(rep: CapabilityReport) -> set[str]:
    return {c.name for c in rep.capabilities if c.available}


def _by_name(rep: CapabilityReport, name: str) -> Capability:
    cap = rep.get(name)
    assert cap is not None, f"capability {name!r} missing from report"
    return cap


# ---- shape ------------------------------------------------------------------


def test_compute_returns_all_thirteen_capabilities() -> None:
    rep = compute_capabilities(_healthy_state())
    names = {c.name for c in rep.capabilities}
    assert names == {
        "emergency_pause",
        "objective_mismatch_alert",
        "creative_fatigue_alert",
        "pool_misalignment_alert",
        "set_monthly_budget_alert",
        "set_kpi_target",
        "scale_up",
        "scale_down",
        "new_creative",
        "new_campaign",
        "expand_audience",
        "redeploy_creative",
        "ab_test_decide",
    }
    assert rep.blocked_count + rep.available_count == len(rep.capabilities)


def test_pure_function_same_input_same_output() -> None:
    state = _healthy_state()
    a = compute_capabilities(state).to_dict()
    b = compute_capabilities(state).to_dict()
    assert a == b


def test_empty_state_blocks_everything_gated() -> None:
    """No state at all → only the structural-alert capabilities (which have
    no requirements) remain available. The five always-available capabilities
    are the safety/observation alerts that need no premise."""
    rep = compute_capabilities({})
    available = _names_available(rep)
    assert available == {
        "emergency_pause",
        "objective_mismatch_alert",
        "creative_fatigue_alert",
        "pool_misalignment_alert",
        "set_monthly_budget_alert",
    }


def test_none_state_does_not_crash() -> None:
    rep = compute_capabilities(None)  # type: ignore[arg-type]
    assert rep.blocked_count > 0


# ---- per-capability gates ---------------------------------------------------


def test_healthy_state_unlocks_scale_up() -> None:
    rep = compute_capabilities(_healthy_state())
    cap = _by_name(rep, "scale_up")
    assert cap.available is True
    assert cap.blocked_by == []


def test_tracking_unverified_blocks_scale_spend_capabilities() -> None:
    state = _healthy_state()
    state["tracking_health"] = {
        "status": "unverified",
        "blocks_proposals": [
            "new_campaign",
            "scale_up",
            "new_creative",
            "expand_audience",
        ],
    }
    rep = compute_capabilities(state)
    for cap_name in (
        "scale_up",
        "scale_down",
        "new_creative",
        "new_campaign",
        "expand_audience",
        "redeploy_creative",
    ):
        cap = _by_name(rep, cap_name)
        assert cap.available is False, f"{cap_name} should be blocked when tracking unverified"
        assert "tracking_verified" in cap.blocked_by


def test_tracking_risk_override_unblocks() -> None:
    """When the operator has opted out of the tracking-block safeguard
    (check_tracking_health emits risk_override_active=true + empty
    blocks_proposals), the capability passes despite status!=healthy."""
    state = _healthy_state()
    state["tracking_health"] = {
        "status": "partial",
        "risk_override_active": True,
        "blocks_proposals": [],
    }
    rep = compute_capabilities(state)
    assert _by_name(rep, "scale_up").available is True


def test_missing_primary_kpi_blocks_scale_up_and_new_campaign() -> None:
    state = _healthy_state()
    state["business"]["primary_kpi"] = None
    rep = compute_capabilities(state)
    assert "primary_kpi_set" in _by_name(rep, "scale_up").blocked_by
    assert "primary_kpi_set" in _by_name(rep, "new_campaign").blocked_by
    # scale_down also requires primary_kpi per TODO table
    assert "primary_kpi_set" in _by_name(rep, "scale_down").blocked_by


def test_target_value_missing_blocks_scale_up_and_new_campaign() -> None:
    state = _healthy_state()
    state["business"]["target_cpl_ils"] = None
    rep = compute_capabilities(state)
    assert "target_value_set" in _by_name(rep, "scale_up").blocked_by
    assert "target_value_set" in _by_name(rep, "new_campaign").blocked_by


def test_kpi_research_insufficient_blocks_set_kpi_target() -> None:
    state = _healthy_state()
    state["kpi_research"] = {"sources": [{"title": "only-one"}], "matched_terms": []}
    rep = compute_capabilities(state)
    cap = _by_name(rep, "set_kpi_target")
    assert cap.available is False
    assert "research_sources_at_least_2" in cap.blocked_by
    assert "matched_terms_present" in cap.blocked_by


def test_utilization_below_50_blocks_new_creative() -> None:
    state = _healthy_state()
    state["campaign_state"]["utilization_7d"] = 0.3
    rep = compute_capabilities(state)
    cap = _by_name(rep, "new_creative")
    assert cap.available is False
    assert "utilization_7d_at_least_50" in cap.blocked_by


def test_campaign_in_learning_blocks_scale_up() -> None:
    state = _healthy_state()
    state["campaign_state"]["in_learning"] = True
    rep = compute_capabilities(state)
    assert "not_in_learning" in _by_name(rep, "scale_up").blocked_by


def test_cpa_at_or_below_target_blocks_expand_audience() -> None:
    state = _healthy_state()
    state["campaign_state"]["cpa_vs_target_ratio"] = 0.9
    rep = compute_capabilities(state)
    cap = _by_name(rep, "expand_audience")
    assert cap.available is False
    assert "cpa_above_target" in cap.blocked_by


def test_no_ab_test_in_scope_blocks_decide() -> None:
    state = _healthy_state()
    state["campaign_state"].pop("ab_test_age_days", None)
    rep = compute_capabilities(state)
    cap = _by_name(rep, "ab_test_decide")
    assert cap.available is False
    assert "test_age_at_least_7d" in cap.blocked_by


def test_emergency_pause_always_available_regardless_of_state() -> None:
    rep = compute_capabilities({})
    cap = _by_name(rep, "emergency_pause")
    assert cap.available is True
    assert cap.blocked_by == []


def test_structural_alerts_always_available_no_premise_required() -> None:
    """The four *_alert capabilities have no Category B requirements —
    they exist precisely to surface findings the agent can't otherwise act
    on (objective_mismatch, creative_fatigue, etc.)."""
    rep = compute_capabilities({"tracking_health": {"status": "unverified"}})
    for alert_cap in (
        "objective_mismatch_alert",
        "creative_fatigue_alert",
        "pool_misalignment_alert",
        "set_monthly_budget_alert",
    ):
        assert _by_name(rep, alert_cap).available is True


def test_blocked_count_is_sum_of_blocked_capabilities() -> None:
    rep = compute_capabilities({})
    blocked = sum(1 for c in rep.capabilities if not c.available)
    assert rep.blocked_count == blocked


def test_to_dict_round_trips_capability_list() -> None:
    rep = compute_capabilities(_healthy_state())
    d = rep.to_dict()
    assert d["available_count"] == rep.available_count
    assert d["blocked_count"] == rep.blocked_count
    assert isinstance(d["capabilities"], list)
    assert all(isinstance(c, dict) for c in d["capabilities"])
    assert all("name" in c and "available" in c for c in d["capabilities"])
