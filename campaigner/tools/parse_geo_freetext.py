"""
tools/parse_geo_freetext.py — Hebrew free-text → Meta targeting JSON
(Mastery v2 Phase D, 2026-05-17).

Operator types something like:
  "ת"א, רמת גן, גבעתיים, גילאי 28-50, החרגת אילת"

This tool returns:
  {
    "geo_locations": {"cities": [{"key": "...", "name": "תל אביב"}, ...]},
    "excluded_geo_locations": {"cities": [{"key": "...", "name": "אילת"}]},
    "age_min": 28, "age_max": 50,
    "confidence": "high" | "medium" | "low",
    "requires_operator": false,
    "warnings": []
  }

v1 SCOPE (tractable):
  - city lists (Israeli cities via curated gazetteer)
  - country ("ישראל" / "Israel")
  - radius around a city ("20 ק"מ סביב הרצליה")
  - age ranges ("גילאי 28-50", "מעל 30")
  - country-minus-city ("כל הארץ למעט אילת")

OUT OF SCOPE (return requires_operator=True):
  - sub-city neighborhoods ("צפון העיר", "פלורנטין") — Meta doesn't expose
  - implicit demographics ("אנשי הייטק") — interest in disguise, banned
  - sociolects ("דתיים", "ערבים") — Meta retired most facets

Per feedback_targeting_owned_by_user: the agent never proposes interest /
behavior / lookalike targeting. This tool's job is geo + age only.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import re

from campaigner.tools._contract import emit_success, emit_validation_error

# Curated Israeli-city gazetteer. Meta city keys are stable; the small ones
# here cover ~90% of Aiweon B2B operator usage. Extend as needed.
IL_CITIES: dict[str, dict[str, str]] = {
    "תל אביב": {"key": "2624283", "name": "Tel Aviv-Yafo"},
    'ת"א': {"key": "2624283", "name": "Tel Aviv-Yafo"},
    "ת''א": {"key": "2624283", "name": "Tel Aviv-Yafo"},
    "ירושלים": {"key": "2533216", "name": "Jerusalem"},
    "חיפה": {"key": "2334008", "name": "Haifa"},
    "ראשון לציון": {"key": "2557352", "name": "Rishon LeZion"},
    "פתח תקווה": {"key": "2549987", "name": "Petah Tikva"},
    "אשדוד": {"key": "2461797", "name": "Ashdod"},
    "נתניה": {"key": "2542884", "name": "Netanya"},
    "באר שבע": {"key": "2483854", "name": "Beersheba"},
    "באר-שבע": {"key": "2483854", "name": "Beersheba"},
    "חולון": {"key": "2334007", "name": "Holon"},
    "בני ברק": {"key": "2486027", "name": "Bnei Brak"},
    "רמת גן": {"key": "2556568", "name": "Ramat Gan"},
    'ר"ג': {"key": "2556568", "name": "Ramat Gan"},
    "אשקלון": {"key": "2461795", "name": "Ashkelon"},
    "רחובות": {"key": "2554879", "name": "Rehovot"},
    "בת ים": {"key": "2486006", "name": "Bat Yam"},
    "כפר סבא": {"key": "2526025", "name": "Kfar Saba"},
    "הרצליה": {"key": "2330804", "name": "Herzliya"},
    "הוד השרון": {"key": "2330801", "name": "Hod HaSharon"},
    "רעננה": {"key": "2554880", "name": "Ra'anana"},
    "מודיעין": {"key": "2540015", "name": "Modi'in-Maccabim-Re'ut"},
    "רמלה": {"key": "2554881", "name": "Ramla"},
    "לוד": {"key": "2538998", "name": "Lod"},
    "נצרת": {"key": "2542882", "name": "Nazareth"},
    "גבעתיים": {"key": "2317901", "name": "Givatayim"},
    "ראש העין": {"key": "2554878", "name": "Rosh HaAyin"},
    "אילת": {"key": "2461793", "name": "Eilat"},
    "טבריה": {"key": "2334006", "name": "Tiberias"},
    "צפת": {"key": "2549985", "name": "Safed"},
}

# Phrases that signal "country, all of Israel"
IL_ALL_PHRASES = ("ישראל", "כל הארץ", "כל ישראל", "ארץ ישראל", "israel", "all of israel")

# Phrases that should refuse with requires_operator=True
INTEREST_DISGUISE_HINTS = (
    "הייטק",
    "אנשי",
    "מנהלי",
    "סטארטאפ",
    "יזמים",
    "דתיים",
    "חרדים",
    "ערבים",
    "מסורתיים",
    "צעירים",
    "מבוגרים",
    "סטודנטים",
)

SUB_CITY_HINTS = ("צפון העיר", "דרום העיר", "מרכז העיר", "פלורנטין", "רוממה", "נווה")


def _detect_age(text: str) -> tuple[int | None, int | None]:
    """Pull age_min / age_max from Hebrew patterns."""
    # "גילאי 28-50" or "גילאים 28-50" or "28 עד 50"
    m = re.search(r"גיל(?:אי|אים|)?\s*(\d{1,2})\s*[-–עד]+\s*(\d{1,2})", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(\d{1,2})\s*עד\s*(\d{1,2})", text)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if 18 <= a <= 65 and 18 <= b <= 65:
            return a, b
    # "מעל 30"
    m = re.search(r"מעל\s*(\d{1,2})", text)
    if m:
        return int(m.group(1)), None
    # "עד 50"
    m = re.search(r"עד גיל\s*(\d{1,2})", text)
    if m:
        return None, int(m.group(1))
    return None, None


def _detect_radius(text: str) -> tuple[str, int] | None:
    """Detect 'X ק"מ סביב <city>' pattern."""
    m = re.search(r'(\d+)\s*ק"?מ\s*(?:סביב|מ)\s*([^,]+)', text)
    if m:
        city_raw = m.group(2).strip()
        for ckey in IL_CITIES:
            if ckey in city_raw:
                return ckey, int(m.group(1))
    return None


def _detect_cities(text: str, exclude_terms: set[str]) -> list[dict[str, str]]:
    """Find Israeli cities in the text. exclude_terms = cities that appeared
    after a 'למעט' / 'החרגה' keyword (handled separately)."""
    found: list[dict[str, str]] = []
    for hebrew, meta_info in IL_CITIES.items():
        if hebrew in text and hebrew not in exclude_terms:
            entry = {"key": meta_info["key"], "name": meta_info["name"]}
            if entry not in found:
                found.append(entry)
    return found


def _detect_exclusions(text: str) -> list[dict[str, str]]:
    """Find cities after 'למעט' / 'החרגה' / 'מלבד' keywords."""
    out: list[dict[str, str]] = []
    patterns = [
        r"למעט\s+([^,.]+)",
        r"החרגה\s+([^,.]+)",
        r"החרגת?\s+([^,.]+)",
        r"מלבד\s+([^,.]+)",
        r"לא כולל\s+([^,.]+)",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            chunk = m.group(1)
            for hebrew, meta_info in IL_CITIES.items():
                if hebrew in chunk:
                    entry = {"key": meta_info["key"], "name": meta_info["name"]}
                    if entry not in out:
                        out.append(entry)
    return out


def main() -> None:
    p = argparse.ArgumentParser(
        description="Parse Hebrew free-text into Meta geo + age targeting JSON.",
    )
    p.add_argument("--text", required=True, help="Hebrew free-text from operator")
    args = p.parse_args()

    text = args.text.strip()
    if not text:
        emit_validation_error("--text must be non-empty")
        return

    warnings: list[str] = []
    requires_operator = False

    # Refuse patterns: interest-in-disguise, sociolects
    for hint in INTEREST_DISGUISE_HINTS:
        if hint in text:
            requires_operator = True
            warnings.append(
                f"זוהה ביטוי שדומה לטרגוט עניין/דמוגרפי משתמע: '{hint}'. "
                f"לפי מדיניות, טרגוט קהלי-עניין הוא באחריות המפעיל בלבד — "
                f"לא הסוכן. הוסף ידנית ב-Meta או הסר את המילה."
            )

    # Refuse patterns: sub-city neighborhoods
    for hint in SUB_CITY_HINTS:
        if hint in text:
            requires_operator = True
            warnings.append(
                f"זוהה ביטוי שכונתי ('{hint}'). Meta לא חושפת שכונות "
                f"כיחידות טרגוט נטיביות. אפשרויות: (1) בחר את העיר השלמה, "
                f"(2) הגדר רדיוס סביב נקודה."
            )

    if requires_operator:
        emit_success(
            {
                "requires_operator": True,
                "warnings": warnings,
                "confidence": "low",
                "geo_locations": None,
                "excluded_geo_locations": None,
                "age_min": None,
                "age_max": None,
            }
        )
        return

    # Build the geo block.
    excluded_cities = _detect_exclusions(text)
    excluded_names = {c["name"] for c in excluded_cities}
    cities = [c for c in _detect_cities(text, excluded_names) if c["name"] not in excluded_names]

    radius = _detect_radius(text)
    if radius:
        ckey_hebrew, radius_km = radius
        info = IL_CITIES[ckey_hebrew]
        if not any(c["key"] == info["key"] for c in cities):
            cities.append(
                {
                    "key": info["key"],
                    "name": info["name"],
                    "radius": str(radius_km),
                    "distance_unit": "kilometer",
                }
            )

    geo_locations: dict | None = None
    if cities:
        geo_locations = {"cities": cities}
    elif any(p in text.lower() for p in IL_ALL_PHRASES):
        geo_locations = {"countries": ["IL"]}
    else:
        warnings.append("לא זוהו ערים או מדינה. הסוכן ייפעל בברירת מחדל 'כל ישראל'.")
        geo_locations = {"countries": ["IL"]}

    excluded_geo_locations = {"cities": excluded_cities} if excluded_cities else None

    age_min, age_max = _detect_age(text)

    # Confidence heuristic
    n_signals = sum(bool(x) for x in (cities, excluded_cities, radius, age_min, age_max))
    if n_signals >= 2 and not warnings:
        confidence = "high"
    elif n_signals >= 1:
        confidence = "medium"
    else:
        confidence = "low"

    emit_success(
        {
            "requires_operator": False,
            "warnings": warnings,
            "confidence": confidence,
            "geo_locations": geo_locations,
            "excluded_geo_locations": excluded_geo_locations,
            "age_min": age_min,
            "age_max": age_max,
            "parsed_cities_count": len(cities),
            "parsed_excluded_count": len(excluded_cities),
        }
    )


if __name__ == "__main__":
    main()
