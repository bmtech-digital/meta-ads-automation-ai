"""
Unit tests for §42 `geo_targeting_set_for_new_campaign` (Phase 1 add-on,
migration 025, 2026-05-13).

Soft warning when a `new_campaign` is proposed for a business whose
`business_knowledge.geo_targeting` is null/empty. Never blocks — surfaces
`warning=True` so the operator notices the campaign would inherit Meta's
"all of Israel" default.

Pure-function tests. The rule does a DB lookup via fetch_one; we
monkeypatch it so no real DB is required.
"""

from __future__ import annotations

import pytest

from campaigner.tools import check_guardrails as gr
from campaigner.tools.check_guardrails import _geo_targeting_set_for_new_campaign


@pytest.fixture
def patch_fetch_one(monkeypatch):
    """Returns a setter — call setter(value) to control what fetch_one returns."""
    holder: dict = {"row": None}

    def fake_fetch_one(_sql: str, _params: tuple) -> dict | None:
        return holder["row"]

    monkeypatch.setattr(gr, "fetch_one", fake_fetch_one)
    return lambda row: holder.update(row=row)


# ---------- only fires on new_campaign


def test_passes_for_non_new_campaign_task_types():
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "budget_change", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("warning") is not True
    assert "only applies to new_campaign" in r["note"]


# ---------- skips when context is incomplete


def test_skips_when_business_id_missing():
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign"}, {}, {}
    )
    assert r["passed"] is True
    assert r["skipped"] is True


# ---------- warns on missing geo_targeting


def test_warns_when_geo_targeting_null(patch_fetch_one):
    patch_fetch_one({"geo_targeting": None})
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r["warning"] is True
    assert "empty/null" in r["note"]


def test_warns_when_geo_targeting_row_missing(patch_fetch_one):
    patch_fetch_one(None)
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r["warning"] is True


def test_warns_when_include_block_empty(patch_fetch_one):
    patch_fetch_one({"geo_targeting": {"include": {}, "exclude": {"countries": ["PS"]}}})
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r["warning"] is True


# ---------- pass (no warning) when include is populated


def test_passes_clean_when_include_has_countries(patch_fetch_one):
    patch_fetch_one({"geo_targeting": {"include": {"countries": ["IL"]}}})
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("warning") is not True
    assert "populated" in r["note"]


def test_passes_clean_when_include_has_cities(patch_fetch_one):
    patch_fetch_one(
        {
            "geo_targeting": {
                "include": {"cities": [{"key": "2643743", "name": "Tel Aviv"}]}
            }
        }
    )
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("warning") is not True


def test_passes_clean_when_include_has_radius_centers(patch_fetch_one):
    patch_fetch_one(
        {
            "geo_targeting": {
                "include": {
                    "radius_centers": [
                        {
                            "name": "office",
                            "latitude": 32.0853,
                            "longitude": 34.7818,
                            "radius_km": 25,
                        }
                    ]
                }
            }
        }
    )
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r.get("warning") is not True


# ---------- exclude-only is NOT enough — Meta needs a positive include


def test_warns_when_only_excludes_set(patch_fetch_one):
    """Exclude-only block doesn't define what to target — still a warning."""
    patch_fetch_one(
        {
            "geo_targeting": {
                "exclude": {"cities": [{"key": "1234", "name": "Bnei Brak"}]}
            }
        }
    )
    r = _geo_targeting_set_for_new_campaign(
        {"task_type": "new_campaign", "business_id": "biz-1"}, {}, {}
    )
    assert r["passed"] is True
    assert r["warning"] is True
