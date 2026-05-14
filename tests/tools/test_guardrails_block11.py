"""
Unit tests for the §29 and §30 A/B test guardrails shipped 2026-05-13 in
Block 11 (A/B test orchestration).

  §29 ab_test_requires_min_creatives — payload.creatives must have 2-4 entries
                                       with unique single-uppercase-letter labels
  §30 ab_test_min_window_7d          — payload.window_days >= 7 on setup;
                                       ab_test_days_elapsed in ctx >= 7 on decide
                                       (unless cancel_instead=true)

Pure-function tests — no DB, no Meta. Run via Docker per tests/CLAUDE.md.
"""

from __future__ import annotations

from campaigner.tools.check_guardrails import (
    _ab_test_min_window_7d,
    _ab_test_requires_min_creatives,
)

# ============================== §29 ===========================================


def _setup_payload(creatives, **kwargs):
    base = {
        "test_name": "t",
        "campaign_id": "c1",
        "adset_id": "a1",
        "winner_metric": "ctr",
        "window_days": 7,
        "creatives": creatives,
    }
    base.update(kwargs)
    return {"task_type": "ab_test_setup", "payload": base}


def test_min_creatives_passes_with_2():
    r = _ab_test_requires_min_creatives(
        _setup_payload(
            [
                {"creative_id": "x", "variant_label": "A"},
                {"creative_id": "y", "variant_label": "B"},
            ]
        ),
        {},
        {},
    )
    assert r["passed"] is True
    assert r["count"] == 2


def test_min_creatives_passes_with_4():
    r = _ab_test_requires_min_creatives(
        _setup_payload(
            [
                {"creative_id": "w", "variant_label": "A"},
                {"creative_id": "x", "variant_label": "B"},
                {"creative_id": "y", "variant_label": "C"},
                {"creative_id": "z", "variant_label": "D"},
            ]
        ),
        {},
        {},
    )
    assert r["passed"] is True
    assert r["count"] == 4


def test_min_creatives_fails_with_1():
    r = _ab_test_requires_min_creatives(
        _setup_payload([{"creative_id": "x", "variant_label": "A"}]),
        {},
        {},
    )
    assert r["passed"] is False
    assert "≥ 2" in r["reason"]


def test_min_creatives_fails_with_5():
    r = _ab_test_requires_min_creatives(
        _setup_payload(
            [{"creative_id": f"c{i}", "variant_label": chr(ord("A") + i)} for i in range(5)]
        ),
        {},
        {},
    )
    assert r["passed"] is False
    assert "capped at 4" in r["reason"]


def test_min_creatives_fails_with_duplicate_labels():
    r = _ab_test_requires_min_creatives(
        _setup_payload(
            [
                {"creative_id": "x", "variant_label": "A"},
                {"creative_id": "y", "variant_label": "A"},
            ]
        ),
        {},
        {},
    )
    assert r["passed"] is False
    assert "unique" in r["reason"]


def test_min_creatives_fails_with_lowercase_label():
    r = _ab_test_requires_min_creatives(
        _setup_payload(
            [
                {"creative_id": "x", "variant_label": "a"},
                {"creative_id": "y", "variant_label": "B"},
            ]
        ),
        {},
        {},
    )
    assert r["passed"] is False


def test_min_creatives_fails_with_missing_list():
    r = _ab_test_requires_min_creatives(
        {"task_type": "ab_test_setup", "payload": {}},
        {},
        {},
    )
    assert r["passed"] is False
    assert "must be a list" in r["reason"]


def test_min_creatives_does_not_apply_to_other_tasks():
    for task in ("ab_test_decide", "new_creative", "scale_up"):
        r = _ab_test_requires_min_creatives(
            {"task_type": task, "payload": {}},
            {},
            {},
        )
        assert r["passed"] is True, f"§29 should not apply to {task}"


# ============================== §30 ===========================================


def test_min_window_setup_passes_at_7():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_setup", "payload": {"window_days": 7}},
        {},
        {},
    )
    assert r["passed"] is True
    assert r["window_days"] == 7


def test_min_window_setup_passes_at_21():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_setup", "payload": {"window_days": 21}},
        {},
        {},
    )
    assert r["passed"] is True


def test_min_window_setup_fails_at_5():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_setup", "payload": {"window_days": 5}},
        {},
        {},
    )
    assert r["passed"] is False
    assert "7" in r["reason"]


def test_min_window_setup_fails_at_100():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_setup", "payload": {"window_days": 100}},
        {},
        {},
    )
    assert r["passed"] is False
    assert "90" in r["reason"]


def test_min_window_setup_fails_when_missing():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_setup", "payload": {}},
        {},
        {},
    )
    assert r["passed"] is False


# decide path


def test_min_window_decide_passes_after_7d():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_decide", "payload": {"ab_test_id": "x"}},
        {},
        {"ab_test_days_elapsed": 8},
    )
    assert r["passed"] is True
    assert r["days_elapsed"] == 8


def test_min_window_decide_fails_before_7d():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_decide", "payload": {"ab_test_id": "x"}},
        {},
        {"ab_test_days_elapsed": 5},
    )
    assert r["passed"] is False
    assert "5" in r["reason"]


def test_min_window_decide_passes_when_cancel_instead():
    """cancel_instead=true overrides the window check — cancellation is
    legitimate at any time."""
    r = _ab_test_min_window_7d(
        {
            "task_type": "ab_test_decide",
            "payload": {"ab_test_id": "x", "cancel_instead": True},
        },
        {},
        {"ab_test_days_elapsed": 2},
    )
    assert r["passed"] is True
    assert "cancel_instead" in (r.get("note") or "").lower()


def test_min_window_decide_skips_when_days_elapsed_missing():
    r = _ab_test_min_window_7d(
        {"task_type": "ab_test_decide", "payload": {"ab_test_id": "x"}},
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


def test_min_window_does_not_apply_to_other_tasks():
    for task in ("scale_up", "new_creative", "boost_post"):
        r = _ab_test_min_window_7d(
            {"task_type": task, "payload": {}},
            {},
            {},
        )
        assert r["passed"] is True, f"§30 should not apply to {task}"


# ====================== registered in CHECKS list =============================


def test_rules_registered_in_checks_list():
    """Both §29 and §30 must be wired into the global CHECKS list."""
    from campaigner.tools.check_guardrails import CHECKS

    rule_names = []
    for fn in CHECKS:
        r = fn({"task_type": "noop"}, {}, {})
        if isinstance(r, dict) and "name" in r:
            rule_names.append(r["name"])

    assert "ab_test_requires_min_creatives" in rule_names
    assert "ab_test_min_window_7d" in rule_names
