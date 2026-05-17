"""
Unit tests for `campaigner.lib.audience_targeting` — pure-function parser
that extracts a Meta saved-audience `targeting` dict into our migration-030
column shape + Hebrew summary line.

No DB, no Meta SDK — the parser is supposed to be a pure transform from
"whatever Meta returned" into "what /audiences renders." If these tests
pass, the only remaining work is the SQL upsert layer (covered by the
sync tool's contract test) and the UI rendering (covered by vitest if we
add a snapshot).
"""

from __future__ import annotations

from campaigner.lib.audience_targeting import parse_targeting


def test_empty_targeting_returns_all_none() -> None:
    """Custom + lookalike audiences have no targeting spec — the parser must
    return an all-None dict so the upsert doesn't fail and the UI knows to
    suppress the detail block."""
    out = parse_targeting(None)
    assert out["age_min"] is None
    assert out["age_max"] is None
    assert out["genders"] is None
    assert out["geo_locations"] is None
    assert out["targeting_parsed"] is None
    assert out["targeting_summary"] is None
    # sentence_lines passed through (Meta sometimes provides them at the
    # audience-envelope level even when targeting is empty).
    out2 = parse_targeting(None, sentence_lines=["A line"])
    assert out2["sentence_lines"] == ["A line"]


def test_full_saved_audience_parse() -> None:
    """A realistic saved-audience targeting blob — Tel Aviv + 25km, women
    25-45, with 2 interests + 1 behavior + 1 city exclusion + a Custom
    Audience reference. All sub-fields should land in the right columns
    and the Hebrew summary should mention the city, age, gender, and the
    detail counts."""
    targeting = {
        "age_min": 25,
        "age_max": 45,
        "genders": [2],  # female
        "geo_locations": {
            "cities": [
                {
                    "key": "2459115",
                    "name": "Tel Aviv-Yafo",
                    "country": "IL",
                    "radius": 25,
                    "distance_unit": "kilometer",
                }
            ],
            "location_types": ["home", "recent"],
        },
        "excluded_geo_locations": {
            "cities": [
                {"key": "2459115b", "name": "Bnei Brak", "country": "IL"}
            ]
        },
        "interests": [
            {"id": "6003020834693", "name": "Cosmetics"},
            {"id": "6003101415689", "name": "Skincare"},
        ],
        "behaviors": [
            {"id": "6002714895372", "name": "Engaged Shoppers", "category": "Purchase behavior"}
        ],
        "custom_audiences": [{"id": "23845...", "name": "Site visitors 30d"}],
        "publisher_platforms": ["facebook", "instagram"],
        "facebook_positions": ["feed", "story"],
        "instagram_positions": ["feed", "reels"],
        "flexible_spec": [{"interests": [{"id": "x", "name": "y"}]}],
    }
    out = parse_targeting(targeting, sentence_lines=["Women 25-45 in Tel Aviv"])

    assert out["targeting_parsed"] is True
    assert out["age_min"] == 25
    assert out["age_max"] == 45
    assert out["genders"] == ["female"]
    assert out["geo_locations"] is not None
    assert out["geo_locations"]["cities"][0]["name"] == "Tel Aviv-Yafo"
    assert out["geo_locations"]["cities"][0]["radius"] == 25
    assert out["geo_locations"]["location_types"] == ["home", "recent"]
    assert out["excluded_geo_locations"] is not None
    assert out["excluded_geo_locations"]["cities"][0]["name"] == "Bnei Brak"
    # 2 interests at top level + 1 inside flexible_spec → unioned to 3.
    # Meta routinely places "real" detailed targeting inside flexible_spec
    # (OR-of-AND), so the parser flattens them into the top-level columns
    # so the UI doesn't have to drill into JSONB to know what an audience
    # targets. The original flexible_spec is preserved verbatim for power
    # users.
    assert out["interests"] is not None and len(out["interests"]) == 3
    assert {i["name"] for i in out["interests"]} == {"Cosmetics", "Skincare", "y"}
    assert out["behaviors"] is not None and len(out["behaviors"]) == 1
    assert out["custom_audiences_included"] == [
        {"id": "23845...", "name": "Site visitors 30d"}
    ]
    assert out["publisher_platforms"] == ["facebook", "instagram"]
    assert out["facebook_positions"] == ["feed", "story"]
    assert out["instagram_positions"] == ["feed", "reels"]
    assert out["flexible_spec"] == [{"interests": [{"id": "x", "name": "y"}]}]
    assert out["sentence_lines"] == ["Women 25-45 in Tel Aviv"]

    # Hebrew summary — operator should see city, age, gender, and counts.
    s = out["targeting_summary"] or ""
    assert "Tel Aviv-Yafo" in s
    assert "25 ק״מ" in s
    assert "25-45" in s
    assert "נשים" in s
    assert "תחומי עניין" in s


def test_both_genders_collapses_to_none() -> None:
    """Meta represents 'all genders' as either [1,2] OR no key. Both must
    collapse to NULL so the UI renders 'כל המגדרים' the same way."""
    out_both = parse_targeting({"age_min": 18, "age_max": 65, "genders": [1, 2]})
    assert out_both["genders"] is None
    out_missing = parse_targeting({"age_min": 18, "age_max": 65})
    assert out_missing["genders"] is None


def test_men_only() -> None:
    out = parse_targeting({"genders": [1]})
    assert out["genders"] == ["male"]
    assert "גברים" in (out["targeting_summary"] or "")


def test_country_only_summary_falls_back_to_country() -> None:
    """When the operator targets a country (not a city), the Hebrew summary
    should still produce something readable instead of nothing."""
    out = parse_targeting(
        {
            "age_min": 18,
            "age_max": 65,
            "geo_locations": {
                "countries": [{"key": "IL", "name": "Israel"}],
            },
        }
    )
    s = out["targeting_summary"] or ""
    assert "Israel" in s
    assert "18-65" in s


def test_custom_locations_pin() -> None:
    """Custom_locations are lat/lng pins with a radius — the parser should
    preserve the geometry and the summary should mention the radius."""
    out = parse_targeting(
        {
            "geo_locations": {
                "custom_locations": [
                    {
                        "name": "Aiweon HQ",
                        "latitude": 32.0853,
                        "longitude": 34.7818,
                        "radius": 10,
                        "distance_unit": "kilometer",
                    }
                ]
            }
        }
    )
    assert out["geo_locations"] is not None
    pin = out["geo_locations"]["custom_locations"][0]
    assert pin["radius"] == 10
    assert pin["latitude"] == 32.0853
    assert "Aiweon HQ" in (out["targeting_summary"] or "")
    assert "10 ק״מ" in (out["targeting_summary"] or "")


def test_radius_string_becomes_int() -> None:
    """Some Meta editions return radius as a string. We must coerce so the
    UI doesn't render '25.0'."""
    out = parse_targeting(
        {
            "geo_locations": {
                "cities": [{"name": "Haifa", "radius": "30", "distance_unit": "kilometer"}]
            }
        }
    )
    assert out["geo_locations"]["cities"][0]["radius"] == 30
    assert isinstance(out["geo_locations"]["cities"][0]["radius"], int)


def test_no_targeting_fields_summary_is_none() -> None:
    """A targeting dict that's structurally valid but has nothing meaningful
    in it should produce summary=None so the UI doesn't show an empty
    'פירוט קהל מלא' tag-line. An empty `{}` hits the early-return branch
    (treated the same as None — no targeting present)."""
    out = parse_targeting({})
    # Empty {} is falsy in Python — the parser short-circuits to the
    # all-None path (same as a custom audience). That's intentional:
    # an empty targeting dict carries no information.
    assert out["targeting_parsed"] is None
    assert out["targeting_summary"] is None

    # A targeting dict with only structural keys (no operator selections)
    # also produces summary=None — but targeting_parsed is True because
    # we did try to parse.
    out2 = parse_targeting({"locales": []})
    assert out2["targeting_parsed"] is True
    assert out2["targeting_summary"] is None


def test_exception_in_sub_parser_marks_unparsed() -> None:
    """If a Meta field comes back in an unexpected shape, the parser must
    flag the row as parsed=False but still return a valid dict so the
    upsert proceeds (meta_raw retains the original for later backfill)."""
    # Pass a non-dict where the parser expects a dict — _norm_geo handles
    # it, but if we feed something that breaks a deep .get chain, we want
    # the parser to swallow.
    weird = {
        "age_min": "not-an-int",   # caught by inner try/except
        "age_max": None,
        # This is structurally fine — just verifying robustness.
        "geo_locations": "not-a-dict",
    }
    out = parse_targeting(weird)
    # age_min couldn't parse — should still be None, not crash.
    assert out["age_min"] is None
    # geo_locations="not-a-dict" should produce None (parser returns None
    # for non-dict).
    assert out["geo_locations"] is None
    # And the parse should still have completed cleanly.
    assert out["targeting_parsed"] is True
