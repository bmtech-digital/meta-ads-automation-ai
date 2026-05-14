"""
Unit tests for the §28 `prefer_gallery_over_generation` guardrail shipped
2026-05-13 in Block 8 (gallery-first creative sourcing).

The rule blocks `new_creative` proposals when ≥ 3 viable unused gallery
assets exist for the same channel. The operator can override by passing
`payload.source_preference = 'generate_new'`.

Pure-function tests — no DB, no Meta. Run via Docker per tests/CLAUDE.md.
"""

from __future__ import annotations

from campaigner.tools.check_guardrails import _prefer_gallery_over_generation


# ---------- block when viable unused count crosses the threshold


def test_blocks_new_creative_when_3_or_more_viable_unused():
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {"channel": "feed"}},
        {},
        {"viable_unused_gallery_count_for_channel": 5},
    )
    assert r["passed"] is False
    assert "5 viable" in r["reason"]
    assert r["viable_unused"] == 5


def test_blocks_at_exactly_3():
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {"channel": "stories"}},
        {},
        {"viable_unused_gallery_count_for_channel": 3},
    )
    assert r["passed"] is False
    assert r["viable_unused"] == 3


# ---------- pass below the threshold


def test_passes_when_2_or_fewer_viable_unused():
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {"channel": "feed"}},
        {},
        {"viable_unused_gallery_count_for_channel": 2},
    )
    assert r["passed"] is True
    assert r.get("viable_unused") == 2


def test_passes_when_zero_viable_unused():
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {"channel": "reels"}},
        {},
        {"viable_unused_gallery_count_for_channel": 0},
    )
    assert r["passed"] is True
    assert r.get("viable_unused") == 0


# ---------- explicit operator override


def test_override_via_source_preference_generate_new():
    r = _prefer_gallery_over_generation(
        {
            "task_type": "new_creative",
            "payload": {"channel": "feed", "source_preference": "generate_new"},
        },
        {},
        {"viable_unused_gallery_count_for_channel": 10},
    )
    assert r["passed"] is True
    assert "override" in (r.get("note") or "").lower()


def test_other_source_preference_does_not_override():
    """Only the exact string 'generate_new' overrides — bogus values don't."""
    r = _prefer_gallery_over_generation(
        {
            "task_type": "new_creative",
            "payload": {"channel": "feed", "source_preference": "bogus"},
        },
        {},
        {"viable_unused_gallery_count_for_channel": 5},
    )
    assert r["passed"] is False


# ---------- rule only applies to new_creative


def test_does_not_apply_to_redeploy_creative():
    """The rule's job is to push the agent FROM new_creative TO redeploy_creative.
    It must not block redeploy_creative proposals themselves."""
    r = _prefer_gallery_over_generation(
        {"task_type": "redeploy_creative", "payload": {"channel": "feed"}},
        {},
        {"viable_unused_gallery_count_for_channel": 10},
    )
    assert r["passed"] is True


def test_does_not_apply_to_scale_up():
    r = _prefer_gallery_over_generation(
        {"task_type": "scale_up"},
        {},
        {"viable_unused_gallery_count_for_channel": 99},
    )
    assert r["passed"] is True


def test_does_not_apply_to_publish_ig_reel():
    r = _prefer_gallery_over_generation(
        {"task_type": "publish_ig_reel"},
        {},
        {"viable_unused_gallery_count_for_channel": 99},
    )
    assert r["passed"] is True


# ---------- skip behavior when context wasn't populated


def test_skips_when_count_not_in_context():
    """If the caller didn't supply the gallery census in ctx, the rule
    returns skipped:true (caller must run list_active_creatives first)."""
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {"channel": "feed"}},
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True
    assert "list_active_creatives" in r["reason"]


def test_skips_when_payload_has_no_channel():
    """Without channel in payload, the context fetcher returns no count,
    so the rule has to skip rather than fail."""
    r = _prefer_gallery_over_generation(
        {"task_type": "new_creative", "payload": {}},
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


# ---------- registered in CHECKS list


def test_rule_registered_in_checks_list():
    """Sanity: §28 is wired into the global CHECKS list so it actually runs
    when check_guardrails main() iterates."""
    from campaigner.tools.check_guardrails import CHECKS

    rule_names = []
    for fn in CHECKS:
        r = fn({"task_type": "noop"}, {}, {})
        if isinstance(r, dict) and "name" in r:
            rule_names.append(r["name"])

    assert "prefer_gallery_over_generation" in rule_names, (
        f"§28 not registered in CHECKS. Got: {rule_names}"
    )
