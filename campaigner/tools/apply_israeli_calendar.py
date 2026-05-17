"""
tools/apply_israeli_calendar.py — Israeli calendar overlay for pacing.
Mastery v2 Phase F (2026-05-17).

Pure function: given a date + the business's seasonal_hints, return the
effective multiplier on monthly_budget for that date AND the cpm_event flag
(periods when CPMs spike for structural reasons, e.g. BFCM-IL, election
week, security events).

Per research synthesis (memory: project_mastery_plan_v2 §1.5):
  August            × 0.75  (B2B vacation slump)
  Tishrei chag-days × 0.50  (Rosh Hashanah, Yom Kippur, Sukkot chag days)
  Tishrei non-chag  × 0.80  (3 weeks of disrupted decision-making)
  Pesach week       × 0.75
  Late Oct-early Dec× 1.18  (strongest B2B buying window)
  Jan-Mar           × 1.10  (budget-cycle window)
  BFCM IL (late Nov)× (no monthly mult, but cpm_event=true; expect +20-80% CPM)

These are DEFAULTS that get merged into businesses.seasonal_hints if the
business hasn't set its own. Operator can override per-business via the
existing seasonal_hints editor.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime

from campaigner.tools._contract import emit_success, emit_validation_error

# All defaults for Israeli calendar. Gregorian dates for windows that recur
# on Gregorian (BFCM, Jan-Mar). Hebrew chagim require year-by-year computation;
# v1 hardcodes the next 3 years and the operator extends from /business-knowledge.

# Format: each entry = {start, end, multiplier, cpm_event, name}
IL_CALENDAR_DEFAULTS_BY_YEAR: dict[int, list[dict]] = {
    2026: [
        # August vacation slump
        {"start": "2026-08-01", "end": "2026-08-31", "multiplier": 0.75, "cpm_event": False, "name": "August vacation"},
        # Tishrei chag-days (Rosh Hashanah Sep 11-13, Yom Kippur Sep 20-21, Sukkot Sep 25-Oct 3)
        {"start": "2026-09-11", "end": "2026-09-13", "multiplier": 0.50, "cpm_event": False, "name": "Rosh Hashanah"},
        {"start": "2026-09-20", "end": "2026-09-21", "multiplier": 0.50, "cpm_event": False, "name": "Yom Kippur"},
        {"start": "2026-09-25", "end": "2026-10-03", "multiplier": 0.65, "cpm_event": False, "name": "Sukkot"},
        # Surrounding Tishrei
        {"start": "2026-09-01", "end": "2026-10-10", "multiplier": 0.80, "cpm_event": False, "name": "Tishrei (general)"},
        # Late Oct - early Dec strongest window
        {"start": "2026-10-15", "end": "2026-12-05", "multiplier": 1.18, "cpm_event": False, "name": "Post-chagim B2B window"},
        # BFCM Israel (Nov 23-30 typically; 2026: Nov 27)
        {"start": "2026-11-25", "end": "2026-12-02", "multiplier": 1.10, "cpm_event": True, "name": "BFCM IL"},
    ],
    2027: [
        # Approximate — operator should refine
        {"start": "2027-08-01", "end": "2027-08-31", "multiplier": 0.75, "cpm_event": False, "name": "August vacation"},
        {"start": "2027-01-01", "end": "2027-03-31", "multiplier": 1.10, "cpm_event": False, "name": "Jan-Mar budget cycle"},
    ],
}


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _windows_for(on: date) -> list[dict]:
    """All default IL-calendar windows active on `on`."""
    pool = IL_CALENDAR_DEFAULTS_BY_YEAR.get(on.year, [])
    active = []
    for w in pool:
        start = _parse_date(w["start"])
        end = _parse_date(w["end"])
        if start and end and start <= on <= end:
            active.append(w)
    return active


def main() -> None:
    p = argparse.ArgumentParser(
        description="Israeli calendar pacing multiplier + cpm_event flag for a date.",
    )
    p.add_argument(
        "--on",
        default=None,
        help="Date YYYY-MM-DD (default: today UTC).",
    )
    p.add_argument(
        "--override-windows",
        default=None,
        help="JSON list of seasonal_hints.windows to merge (operator overrides).",
    )
    args = p.parse_args()

    on = _parse_date(args.on) or datetime.now(UTC).date()

    default_windows = _windows_for(on)
    override_windows: list[dict] = []
    if args.override_windows:
        import json as _json

        try:
            override_windows = _json.loads(args.override_windows)
            if not isinstance(override_windows, list):
                raise ValueError("must be a list")
        except (ValueError, TypeError) as e:
            emit_validation_error(f"--override-windows invalid: {e}")
            return

    # Override wins on name match; otherwise merge.
    override_names = {
        w.get("name") for w in override_windows if isinstance(w, dict)
    }
    merged = [
        w for w in default_windows if w["name"] not in override_names
    ]
    for w in override_windows:
        if not isinstance(w, dict):
            continue
        start = _parse_date(w.get("start"))
        end = _parse_date(w.get("end"))
        if start and end and start <= on <= end:
            merged.append(w)

    multiplier = 1.0
    cpm_event = False
    active_names: list[str] = []
    for w in merged:
        m = w.get("multiplier")
        if isinstance(m, int | float) and m > 0:
            multiplier *= m
        if w.get("cpm_event"):
            cpm_event = True
        if w.get("name"):
            active_names.append(w["name"])

    emit_success(
        {
            "on": on.isoformat(),
            "multiplier": round(multiplier, 4),
            "cpm_event": cpm_event,
            "active_windows": active_names,
            "applies_to_country": "IL",
            "note_he": _build_note(multiplier, cpm_event, active_names),
        }
    )


def _build_note(mult: float, cpm_event: bool, names: list[str]) -> str:
    """Hebrew one-liner explaining why this multiplier."""
    if mult >= 1.05 and cpm_event:
        return f"חלון אגרסיבי + פיק CPM ({', '.join(names)}) — צפי להוצאות גבוהות יחד עם CPL גבוה זמני."
    if mult >= 1.05:
        return f"חלון חיובי (×{mult:.2f}) — {', '.join(names)}. שווה לדחוף תקציב."
    if mult <= 0.85:
        return f"חלון מצומצם (×{mult:.2f}) — {', '.join(names)}. אל לפתוח קמפיינים חדשים, החזק קצב מופחת."
    if cpm_event:
        return f"מולטיפליר חודשי רגיל אבל צפי לקפיצת CPM ({', '.join(names)}). אל להגיב על קפיצת CPM ביום בודד."
    return "אין השפעת חלון פעיל. רגיל."


if __name__ == "__main__":
    main()
