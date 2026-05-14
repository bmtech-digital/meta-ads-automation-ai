"""
Seasonal multiplier — manual bridge to War Chest (v2).

Per decisions-log §1.10: `businesses.seasonal_hints` holds windows the
operator enters by hand. Each window has {start, end, multiplier, confidence}.
On any given date, the effective multiplier is the PRODUCT of multipliers of
all windows that cover that date.

Empty hints → 1.0. Overlap → product (see entry §1.10 "מה נשאר פתוח" for why).

Future v2: same shape, confidence='learned' rows get priority weighting. For
now every window is user_stated and contributes equally.
"""

from __future__ import annotations

from datetime import date
from typing import Any


def _parse_date(raw: Any) -> date | None:
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str):
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None
    return None


def active_windows(seasonal_hints: dict | None, on: date) -> list[dict]:
    """Return windows from `seasonal_hints` that cover `on` (inclusive start/end)."""
    if not seasonal_hints or not isinstance(seasonal_hints, dict):
        return []
    windows = seasonal_hints.get("windows") or []
    if not isinstance(windows, list):
        return []
    active: list[dict] = []
    for w in windows:
        if not isinstance(w, dict):
            continue
        start = _parse_date(w.get("start"))
        end = _parse_date(w.get("end"))
        if start is None or end is None or start > end:
            continue
        if start <= on <= end:
            active.append(w)
    return active


def multiplier_for_date(seasonal_hints: dict | None, on: date) -> float:
    """
    Product of multipliers across all active windows on `on`.

    No active windows → 1.0. Malformed / missing multiplier on a window is
    treated as 1.0 for that window (skipped rather than crashed — seasonal
    hints are operator-entered and shouldn't brick the daily run).
    """
    total = 1.0
    for w in active_windows(seasonal_hints, on):
        m = w.get("multiplier")
        if isinstance(m, int | float) and m > 0:
            total *= float(m)
    return total


def effective_monthly_budget(
    monthly_budget_ils: float | None,
    seasonal_hints: dict | None,
    on: date,
) -> tuple[float, float, list[dict]]:
    """
    Returns (effective_budget, multiplier, active_windows).

    `monthly_budget_ils` None → (0.0, multiplier, windows). Caller decides what
    an unset budget means (typically: skip pace check, log observation).
    """
    m = multiplier_for_date(seasonal_hints, on)
    base = float(monthly_budget_ils or 0)
    return base * m, m, active_windows(seasonal_hints, on)
