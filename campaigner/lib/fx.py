"""
FX resolver — USD/ILS (and friends) using ECB daily rates from frankfurter.app.

Mirrors `web/src/lib/fx.ts`. Both sides need the same conversion because:

- Meta returns ad-account spend in the account's native currency
  (`account_currency` on the insights row). Aiweon's account is USD.
- `businesses.monthly_budget_ils` and every pace/threshold downstream is in
  ILS. Without conversion the morning `budget_health` row says
  "spend_this_month: 484" while the operator's mental model is "₪", which
  silently breaks pace, projected_monthly_spend, status, and every guardrail
  that compares ILS spend to ILS budget.

Cache: module-level dict keyed by `YYYY-MM-DD`. The rate changes ~once per
banking day; intra-day refresh isn't worth the latency. Survives across calls
inside a single tool invocation; cold-starts fetch fresh.

Fallback: 3.7 USD/ILS — conservative, hardcoded — when the API is unreachable.
The agent run still completes; the outputs blob marks `fx.rate_source =
"fallback"` so the human knows the FX line is approximate.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Literal

USD_TO_ILS_FALLBACK = 3.7
FX_TIMEOUT_S = 2.5

# {date_iso: rate}
_rate_cache: dict[str, float] = {}


def _today_key() -> str:
    return datetime.now(UTC).date().isoformat()


def get_usd_to_ils_rate() -> tuple[float, Literal["live", "cached", "fallback"], str]:
    """
    Return (rate, source, date_iso). `source`:
      live      → fetched from frankfurter.app this call
      cached    → reused from module cache (already fetched today)
      fallback  → hardcoded USD_TO_ILS_FALLBACK after a fetch failure
    """
    key = _today_key()
    cached = _rate_cache.get(key)
    if cached is not None:
        return cached, "cached", key
    try:
        req = urllib.request.Request(
            "https://api.frankfurter.app/latest?from=USD&to=ILS",
            headers={"User-Agent": "campaigner-agent/1.0"},
        )
        with urllib.request.urlopen(req, timeout=FX_TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        rate = body.get("rates", {}).get("ILS")
        if not isinstance(rate, (int, float)) or rate <= 0:
            raise ValueError(f"invalid ILS rate in response: {rate!r}")
        rate_f = float(rate)
        _rate_cache[key] = rate_f
        return rate_f, "live", body.get("date") or key
    except (urllib.error.URLError, ValueError, OSError, TimeoutError) as e:
        # Quiet warning — tools route operator-visible errors through their
        # _contract.emit_*. This is a soft degradation, not a failure.
        import sys

        print(
            f"[fx] USD/ILS fetch failed, using fallback {USD_TO_ILS_FALLBACK}: {e}",
            file=sys.stderr,
        )
        return USD_TO_ILS_FALLBACK, "fallback", key


FxSource = Literal["live", "cached", "fallback", "none"]


def convert_to_ils(
    amount: float,
    from_currency: str | None,
) -> tuple[float, float, str, FxSource]:
    """
    Convert `amount` to ILS. Returns (amount_ils, rate_used, source_currency,
    fx_source).

    - from_currency=None or "ILS" → identity, rate_used=1, fx_source="none"
    - from_currency="USD" → ECB rate via `get_usd_to_ils_rate`
    - anything else → pass-through 1:1 + stderr warning. Extend when a real
      EUR/GBP account shows up.
    """
    cur = (from_currency or "ILS").upper()
    if cur == "ILS":
        return amount, 1.0, "ILS", "none"
    if cur == "USD":
        rate, source, _ = get_usd_to_ils_rate()
        return amount * rate, rate, "USD", source
    import sys

    print(
        f"[fx] unsupported currency {cur!r}, passing through 1:1",
        file=sys.stderr,
    )
    return amount, 1.0, cur, "none"
