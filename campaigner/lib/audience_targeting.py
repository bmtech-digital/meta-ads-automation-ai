"""
campaigner/lib/audience_targeting.py — parse Meta saved-audience targeting
into structured columns + Hebrew summary string.

Companion to migration 030. Saved Audiences come back from Meta with a
rich `targeting` object; this module is the single place that knows how
to interpret it. Used by `tools/sync_audiences.py` during the upsert.

Pure functions only — no I/O, no DB, no Meta SDK. Input is a dict
(`row['targeting']` after `export_all_data()`); output is a typed dict
ready to splat into the upsert params.

The Hebrew summary is intentionally short and operator-readable. It is
NOT marketing copy and does NOT need to follow `prompts/hebrew-copy-style.md`
forbidden-tokens table — it is a "what's in this audience?" label for the
UI card, not customer-facing text.
"""

from __future__ import annotations

import contextlib
from typing import Any

# Meta enum: 1=male, 2=female. Empty/missing = all genders.
_GENDER_MAP = {1: "male", 2: "female", "1": "male", "2": "female"}

# Meta sub-key → our column name for the detailed-targeting buckets.
# Listed explicitly (vs. iterating the dict) so a new Meta key doesn't
# silently expand our schema — additions go through migration.
_DETAILED_KEYS = (
    "interests",
    "behaviors",
    "life_events",
    "industries",
    "work_employers",
    "work_positions",
    "education_schools",
    "education_majors",
    "family_statuses",
    "relationship_statuses",
    "income",
    "net_worth",
    "home_ownership",
    "home_type",
    "home_value",
    "ethnic_affinity",
    "generation",
    "politics",
    "interested_in",
)

_PLACEMENT_KEYS = (
    "publisher_platforms",
    "facebook_positions",
    "instagram_positions",
    "audience_network_positions",
    "messenger_positions",
    "device_platforms",
)

_EMPTY_TARGETING: dict[str, Any] = {
    "targeting": None,
    "targeting_summary": None,
    "sentence_lines": None,
    "age_min": None,
    "age_max": None,
    "genders": None,
    "locales": None,
    "geo_locations": None,
    "excluded_geo_locations": None,
    "custom_audiences_included": None,
    "custom_audiences_excluded": None,
    "flexible_spec": None,
    "exclusions": None,
    "targeting_parsed": None,
    **dict.fromkeys(_DETAILED_KEYS),
    **dict.fromkeys(_PLACEMENT_KEYS),
}


def _norm_genders(raw) -> list[str] | None:
    """Meta returns genders as [1], [2], [1,2], or omits. Normalize to
    {male, female} strings; None means "all genders" so the UI can
    render "כל המגדרים" without checking length."""
    if not raw:
        return None
    try:
        names = sorted({_GENDER_MAP.get(g) for g in raw if g in _GENDER_MAP or str(g) in _GENDER_MAP})
        names = [n for n in names if n]
    except TypeError:
        return None
    if not names or len(names) == 2:
        # Both genders selected == no gender filter. Store None so the
        # summary line treats it the same as "key absent".
        return None
    return names


def _norm_city(c: dict) -> dict:
    """Meta city entries can carry radius/distance_unit (e.g. city + 25km).
    Keep what's there; drop the rest so the JSONB doesn't grow noisy."""
    out: dict[str, Any] = {}
    if "key" in c:
        out["key"] = str(c["key"])
    if "name" in c:
        out["name"] = c["name"]
    if "country" in c:
        out["country"] = c["country"]
    if "region" in c:
        out["region"] = c["region"]
    if "radius" in c and c["radius"] is not None:
        with contextlib.suppress(TypeError, ValueError):
            out["radius"] = int(c["radius"])
    if "distance_unit" in c:
        out["distance_unit"] = c["distance_unit"]
    return out


def _norm_geo(g: dict | None) -> dict | None:
    """Extract the geo sub-keys we care about. Returns None when the dict
    is missing or empty — the column stays NULL so a saved audience with
    no geo lock (rare) doesn't lie about being "worldwide"."""
    if not g or not isinstance(g, dict):
        return None
    out: dict[str, Any] = {}
    # Most keys are arrays of {key,name} — copy verbatim, just slim.
    for k in (
        "countries",
        "country_groups",
        "regions",
        "zips",
        "geo_markets",
        "electoral_districts",
        "neighborhoods",
        "subcities",
        "subneighborhoods",
        "medium_geo_areas",
        "large_geo_areas",
        "small_geo_areas",
        "metro_areas",
    ):
        v = g.get(k)
        if v:
            out[k] = v
    # Cities have the radius nuance.
    cities = g.get("cities")
    if cities:
        out["cities"] = [_norm_city(c) for c in cities if isinstance(c, dict)]
    # Custom locations: lat/lng + radius drop pins.
    cust = g.get("custom_locations")
    if cust:
        out["custom_locations"] = [
            {
                k: v
                for k, v in cl.items()
                if k
                in (
                    "name",
                    "address_string",
                    "latitude",
                    "longitude",
                    "radius",
                    "distance_unit",
                    "primary_city_id",
                    "country",
                )
                and v is not None
            }
            for cl in cust
            if isinstance(cl, dict)
        ]
    if "location_types" in g and g["location_types"]:
        out["location_types"] = g["location_types"]
    return out or None


def _norm_custom_audiences(v) -> list[dict] | None:
    """Meta returns custom_audiences as [{id,name}]. Keep both since
    name is what the operator will recognize at a glance."""
    if not v:
        return None
    out = []
    for item in v:
        if not isinstance(item, dict):
            continue
        entry: dict[str, Any] = {}
        if "id" in item:
            entry["id"] = str(item["id"])
        if "name" in item:
            entry["name"] = item["name"]
        if entry:
            out.append(entry)
    return out or None


def _hebrew_summary(parsed: dict) -> str | None:
    """Build a single-line Hebrew summary from the parsed dict. Returns
    None if there's nothing meaningful to say (audience has no targeting
    sub-fields — extremely rare for saved audiences).

    Operator-readable. Examples:
      "תל אביב + 25 ק״מ · גילאי 25-45 · נשים · 5 תחומי עניין"
      "ישראל · גילאי 18-65 · 3 התנהגויות + 2 קהלים מותאמים"
    """
    parts: list[str] = []

    # Geo first — the most identifying axis.
    geo = parsed.get("geo_locations")
    if geo:
        geo_bits: list[str] = []
        cities = geo.get("cities") or []
        for c in cities[:2]:
            name = c.get("name") or c.get("key")
            if not name:
                continue
            radius = c.get("radius")
            unit = c.get("distance_unit")
            unit_he = {"kilometer": "ק״מ", "mile": "מייל"}.get(unit, unit or "")
            if radius:
                geo_bits.append(f"{name} + {radius} {unit_he}".strip())
            else:
                geo_bits.append(name)
        if len(cities) > 2:
            geo_bits.append(f"+ עוד {len(cities) - 2} ערים")
        # Custom location pins (lat/lng circles).
        pins = geo.get("custom_locations") or []
        for p in pins[:1]:
            name = p.get("name") or p.get("address_string") or "מיקום"
            radius = p.get("radius")
            unit_he = {"kilometer": "ק״מ", "mile": "מייל"}.get(
                p.get("distance_unit"), ""
            )
            if radius:
                geo_bits.append(f"{name} + {radius} {unit_he}".strip())
            else:
                geo_bits.append(name)
        if len(pins) > 1:
            geo_bits.append(f"+ עוד {len(pins) - 1} פינים")
        # Regions / countries — only show if no city specificity.
        if not geo_bits:
            regions = geo.get("regions") or []
            for r in regions[:2]:
                if r.get("name"):
                    geo_bits.append(r["name"])
            countries = geo.get("countries") or []
            for ct in countries[:2]:
                # Countries are [{key,name}] OR ["IL"] depending on edition.
                if isinstance(ct, dict) and ct.get("name"):
                    geo_bits.append(ct["name"])
                elif isinstance(ct, str):
                    geo_bits.append({"IL": "ישראל"}.get(ct, ct))
        if geo_bits:
            parts.append(" / ".join(geo_bits))

    # Age range.
    a_min = parsed.get("age_min")
    a_max = parsed.get("age_max")
    if a_min is not None and a_max is not None:
        parts.append(f"גילאי {a_min}-{a_max}")
    elif a_min is not None:
        parts.append(f"גיל {a_min}+")
    elif a_max is not None:
        parts.append(f"עד גיל {a_max}")

    # Gender.
    g = parsed.get("genders") or []
    if g == ["male"]:
        parts.append("גברים")
    elif g == ["female"]:
        parts.append("נשים")

    # Interest / behavior counts (don't list names — too noisy for a one-liner).
    int_count = len(parsed.get("interests") or [])
    beh_count = len(parsed.get("behaviors") or [])
    extras: list[str] = []
    if int_count:
        extras.append(f"{int_count} תחומי עניין")
    if beh_count:
        extras.append(f"{beh_count} התנהגויות")
    le_count = len(parsed.get("life_events") or [])
    if le_count:
        extras.append(f"{le_count} אירועי חיים")
    ind_count = len(parsed.get("industries") or [])
    if ind_count:
        extras.append(f"{ind_count} תחומי עיסוק")
    ca_in = len(parsed.get("custom_audiences_included") or [])
    if ca_in:
        extras.append(f"{ca_in} קהלים מותאמים")
    ca_out = len(parsed.get("custom_audiences_excluded") or [])
    if ca_out:
        extras.append(f"לא כולל {ca_out} קהלים")
    excl_geo = parsed.get("excluded_geo_locations")
    if excl_geo:
        cities = (excl_geo or {}).get("cities") or []
        if cities:
            extras.append(f"לא כולל {len(cities)} ערים")

    if extras:
        parts.append(" + ".join(extras))

    return " · ".join(parts) if parts else None


def parse_targeting(targeting: dict | None, sentence_lines: Any = None) -> dict[str, Any]:
    """Parse a Meta targeting dict into our column shape.

    Args:
      targeting: the `targeting` field from a saved-audience export. May be
        None / empty for custom + lookalike audiences — in that case every
        output field is None and `targeting_parsed` is None (not False).
      sentence_lines: optional `sentence_lines` field from the audience
        envelope (Meta provides English breakdown lines for saved
        audiences). Stored alongside the parsed view.

    Returns a dict matching the migration-030 column set. Safe to splat
    into `cur.execute(... params)` after passing list/dict values through
    json.dumps if your driver doesn't auto-adapt.

    Defensive: any exception inside a sub-parser is swallowed and
    `targeting_parsed=False` is returned so the upsert still proceeds —
    `meta_raw` keeps the original for backfill.
    """
    if not targeting or not isinstance(targeting, dict):
        out = dict(_EMPTY_TARGETING)
        out["sentence_lines"] = sentence_lines or None
        return out

    out: dict[str, Any] = dict(_EMPTY_TARGETING)
    out["targeting"] = targeting
    out["sentence_lines"] = sentence_lines or None

    try:
        # Demographics
        if "age_min" in targeting and targeting["age_min"] is not None:
            with contextlib.suppress(TypeError, ValueError):
                out["age_min"] = int(targeting["age_min"])
        if "age_max" in targeting and targeting["age_max"] is not None:
            with contextlib.suppress(TypeError, ValueError):
                out["age_max"] = int(targeting["age_max"])
        out["genders"] = _norm_genders(targeting.get("genders"))
        if targeting.get("locales"):
            out["locales"] = targeting["locales"]

        # Geo
        out["geo_locations"] = _norm_geo(targeting.get("geo_locations"))
        out["excluded_geo_locations"] = _norm_geo(
            targeting.get("excluded_geo_locations")
        )

        # Detailed targeting buckets — top-level first
        for k in _DETAILED_KEYS:
            v = targeting.get(k)
            if v:
                out[k] = list(v) if isinstance(v, list) else v

        # Custom audiences (refs)
        out["custom_audiences_included"] = _norm_custom_audiences(
            targeting.get("custom_audiences")
        )
        out["custom_audiences_excluded"] = _norm_custom_audiences(
            targeting.get("excluded_custom_audiences")
        )

        # Flexible spec (OR clauses) + non-geo exclusions
        flex = targeting.get("flexible_spec")
        if flex:
            out["flexible_spec"] = flex
            # Meta puts the rich detailed targeting (behaviors / industries /
            # work_employers / work_positions / education / life_events /
            # interests / family / etc.) inside `flexible_spec[N].<key>`, NOT
            # at the top level of `targeting`. Audiences built in Ads Manager
            # with any non-trivial demographic almost always land here. Union
            # the values across all OR-branches (de-duped by id) into the
            # top-level extracted columns so the UI doesn't have to drill into
            # JSONB to know "this audience targets Small business owners +
            # Business Owners + Company size 11-100". The raw `flexible_spec`
            # stays available for power users who care about the OR-of-AND
            # structure (rare in practice).
            for k in _DETAILED_KEYS:
                merged: list = list(out[k] or [])
                seen_ids: set[str] = {
                    str(e.get("id"))
                    for e in merged
                    if isinstance(e, dict) and e.get("id") is not None
                }
                for branch in flex:
                    if not isinstance(branch, dict):
                        continue
                    branch_vals = branch.get(k)
                    if not branch_vals:
                        continue
                    for item in branch_vals:
                        if isinstance(item, dict) and item.get("id") is not None:
                            iid = str(item["id"])
                            if iid in seen_ids:
                                continue
                            seen_ids.add(iid)
                            merged.append(item)
                        elif item not in merged:
                            merged.append(item)
                if merged:
                    out[k] = merged
            # Same union for custom_audiences refs (rare inside flexible_spec
            # but legal — operator can OR a CA ref with an interest set).
            ca_included = list(out["custom_audiences_included"] or [])
            ca_excluded = list(out["custom_audiences_excluded"] or [])
            seen_ca_in = {
                str(e.get("id"))
                for e in ca_included
                if isinstance(e, dict) and e.get("id") is not None
            }
            seen_ca_out = {
                str(e.get("id"))
                for e in ca_excluded
                if isinstance(e, dict) and e.get("id") is not None
            }
            for branch in flex:
                if not isinstance(branch, dict):
                    continue
                bca_in = _norm_custom_audiences(branch.get("custom_audiences"))
                if bca_in:
                    for c in bca_in:
                        cid = str(c.get("id")) if c.get("id") else None
                        if cid and cid not in seen_ca_in:
                            ca_included.append(c)
                            seen_ca_in.add(cid)
                bca_out = _norm_custom_audiences(
                    branch.get("excluded_custom_audiences")
                )
                if bca_out:
                    for c in bca_out:
                        cid = str(c.get("id")) if c.get("id") else None
                        if cid and cid not in seen_ca_out:
                            ca_excluded.append(c)
                            seen_ca_out.add(cid)
            out["custom_audiences_included"] = ca_included or None
            out["custom_audiences_excluded"] = ca_excluded or None
        if targeting.get("exclusions"):
            out["exclusions"] = targeting["exclusions"]

        # Placements
        for k in _PLACEMENT_KEYS:
            v = targeting.get(k)
            if v:
                out[k] = v

        out["targeting_parsed"] = True
        out["targeting_summary"] = _hebrew_summary(out)
    except Exception:
        # Parse hit something unexpected — flag the row so we can
        # backfill later. meta_raw still has the full original.
        out["targeting_parsed"] = False

    return out
