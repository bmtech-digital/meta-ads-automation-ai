"""
Unit tests for the §17 `verify_tracking_infrastructure` guardrail extension
shipped 2026-05-12 in Block 6 (M1 Tracking Health Gate).

The extension added:
  1. `scale_up`, `new_creative`, `expand_audience` to the blocked-task list
     (was: `new_campaign` only).
  2. Preference for `state.tracking_health_status` (output of
     `check_tracking_health.py`) over the raw `tracking_verified` flag.

Pure-function tests — no DB, no Meta. Run via Docker per tests/CLAUDE.md.
"""

from __future__ import annotations

from campaigner.tools.check_guardrails import _verify_tracking_infrastructure

# ---------- expanded blocked-task list (was: new_campaign only)


def test_blocks_new_campaign_when_unverified():
    r = _verify_tracking_infrastructure(
        {"task_type": "new_campaign"},
        {"tracking_verified": False},
        {},
    )
    assert r["passed"] is False


def test_blocks_scale_up_when_unverified():
    r = _verify_tracking_infrastructure(
        {"task_type": "scale_up"},
        {"tracking_verified": False},
        {},
    )
    assert r["passed"] is False


def test_blocks_new_creative_when_unverified():
    r = _verify_tracking_infrastructure(
        {"task_type": "new_creative"},
        {"tracking_verified": False},
        {},
    )
    assert r["passed"] is False


def test_blocks_expand_audience_when_unverified():
    r = _verify_tracking_infrastructure(
        {"task_type": "expand_audience"},
        {"tracking_verified": False},
        {},
    )
    assert r["passed"] is False


def test_passes_unrelated_task_regardless_of_tracking():
    """pause_campaign / alert / verify_pixel_capi remain allowed when
    tracking is broken — these are the recovery path."""
    for task in ("pause_campaign", "alert", "verify_pixel_capi", "set_kpi_target"):
        r = _verify_tracking_infrastructure(
            {"task_type": task},
            {"tracking_verified": False},
            {},
        )
        assert r["passed"] is True, f"task={task} should pass even when tracking unverified"


# ---------- tracking_health_status (new in Block 6) preferred over raw flag


def test_uses_tracking_health_status_when_present():
    """If both tracking_health_status and tracking_verified are in state,
    the status wins — it's the high-level output of check_tracking_health."""
    r = _verify_tracking_infrastructure(
        {"task_type": "scale_up"},
        {"tracking_health_status": "healthy", "tracking_verified": False},
        {},
    )
    assert r["passed"] is True
    assert r.get("tracking_health_status") == "healthy"


def test_blocks_when_status_partial():
    r = _verify_tracking_infrastructure(
        {"task_type": "scale_up"},
        {"tracking_health_status": "partial"},
        {},
    )
    assert r["passed"] is False
    assert "partial" in r["reason"]


def test_blocks_when_status_unverified():
    r = _verify_tracking_infrastructure(
        {"task_type": "new_creative"},
        {"tracking_health_status": "unverified"},
        {},
    )
    assert r["passed"] is False


def test_blocks_when_status_unknown():
    """`unknown` (no business_knowledge row) → block. Conservative default —
    we shouldn't spend money on an account whose tracking state is unknown."""
    r = _verify_tracking_infrastructure(
        {"task_type": "expand_audience"},
        {"tracking_health_status": "unknown"},
        {},
    )
    assert r["passed"] is False


def test_passes_when_status_healthy():
    r = _verify_tracking_infrastructure(
        {"task_type": "new_campaign"},
        {"tracking_health_status": "healthy"},
        {},
    )
    assert r["passed"] is True


# ---------- skip behavior


def test_skips_when_no_signal_in_state():
    """Neither tracking_health_status nor tracking_verified — caller failed
    to run the pre-gate. Skip (not pass, not fail) so the caller surfaces
    the gap in rationale."""
    r = _verify_tracking_infrastructure(
        {"task_type": "scale_up"},
        {},
        {},
    )
    assert r["passed"] is True
    assert r.get("skipped") is True


def test_passes_when_verified_true_and_no_status():
    """Fallback to raw tracking_verified=True when status not provided."""
    r = _verify_tracking_infrastructure(
        {"task_type": "scale_up"},
        {"tracking_verified": True},
        {},
    )
    assert r["passed"] is True
