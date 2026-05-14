"""
HTTP-direct lead-form lookups against Meta Graph.

Phase 2 of the Campaigner Mastery Plan. Used by `sync_leads.py` to mirror Meta
Lead Ads submissions into the local `leads` table. Token model matches
`page_publishing.py` — the caller supplies a decrypted page access token
resolved via `page_tokens.get_fb_publishing_target`. We don't reuse the
facebook-business SDK because lead form endpoints behave better with explicit
HTTP and the request shapes are tiny.

Two endpoints:
  GET /{page_id}/leadgen_forms      → list Lead Forms attached to the Page
  GET /{form_id}/leads              → list submissions for one form

Both honor `since` (Unix int) and pagination. We cap iteration at 500 leads
per form per sync to bound runtime; daily cron + webhook cover the streaming
case.

Requires the user-or-page token to have `leads_retrieval` permission AND the
page-level lead access for the form. The Aiweon user token has both as of
2026-05-13 (verified via debug_token).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

GRAPH_VERSION = "v25.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

LEADGEN_FORM_FIELDS = [
    "id",
    "name",
    "status",
    "leads_count",
    "page",
    "created_time",
    "expired_leads_count",
    "organic_leads_count",
    "questions",
]

LEAD_FIELDS = [
    "id",
    "ad_id",
    "adset_id",
    "campaign_id",
    "form_id",
    "created_time",
    "field_data",
    "custom_disclaimer_responses",
    "is_organic",
    "ad_name",
    "adset_name",
    "campaign_name",
]


class LeadFetchError(RuntimeError):
    """HTTP / Graph-level error during a lead fetch."""


def _get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    with httpx.Client(timeout=20.0) as client:
        r = client.get(url, params=params)
    if r.status_code != 200:
        raise LeadFetchError(
            f"GET {url} returned {r.status_code}: {r.text[:500]}"
        )
    return r.json()


def list_lead_forms(page_id: str, page_access_token: str) -> list[dict]:
    """Return all Lead Forms attached to the page.

    Skips paginated tail beyond the first 200 forms — that's well above any
    realistic SMB use. Returns JSON-safe dicts per form.
    """
    url = f"{GRAPH_BASE}/{page_id}/leadgen_forms"
    params: dict[str, Any] = {
        "access_token": page_access_token,
        "fields": ",".join(LEADGEN_FORM_FIELDS),
        "limit": 200,
    }
    data = _get(url, params)
    return list(data.get("data") or [])


def fetch_leads_for_form(
    form_id: str,
    page_access_token: str,
    *,
    since_unix: int | None = None,
    max_leads: int = 500,
) -> list[dict]:
    """Paginate `/{form_id}/leads`. Returns at most `max_leads` rows.

    `since_unix` filters on Meta's `created_time >= since` (Meta-side).
    Useful for daily incremental syncs. None = full history.

    Returns JSON-safe dicts with `field_data` as Meta's native shape:
      [{"name": "full_name", "values": ["Roi Halamish"]}, ...]
    The caller flattens the keys it cares about into the `leads` table columns.
    """
    url = f"{GRAPH_BASE}/{form_id}/leads"
    params: dict[str, Any] = {
        "access_token": page_access_token,
        "fields": ",".join(LEAD_FIELDS),
        "limit": min(100, max_leads),
    }
    if since_unix is not None:
        # Meta supports `filtering=[{field:"time_created",operator:"GREATER_THAN",value:N}]`
        params["filtering"] = (
            f'[{{"field":"time_created","operator":"GREATER_THAN","value":{int(since_unix)}}}]'
        )

    out: list[dict] = []
    next_url: str | None = url
    next_params: dict[str, Any] | None = params

    while next_url and len(out) < max_leads:
        data = _get(next_url, next_params or {})
        page = data.get("data") or []
        out.extend(page)
        if len(out) >= max_leads:
            break
        nxt = (data.get("paging") or {}).get("next")
        if not nxt:
            break
        # Meta's `next` URL is fully-qualified; pass empty params so we
        # don't double-up access_token.
        next_url = nxt
        next_params = None

    return out[:max_leads]


def fetch_lead_by_id(lead_id: str, page_access_token: str) -> dict:
    """Read one lead by ID — used by the webhook receiver to enrich a
    leadgen notification with the full field_data payload."""
    url = f"{GRAPH_BASE}/{lead_id}"
    params: dict[str, Any] = {
        "access_token": page_access_token,
        "fields": ",".join(LEAD_FIELDS),
    }
    return _get(url, params)


def flatten_field_data(field_data: list[dict] | None) -> dict[str, str]:
    """Convert Meta's `field_data: [{name, values}]` into a flat dict.

    Common keys: full_name, email, phone_number, city, country.
    Custom questions land under their `name` slug. Multi-value fields are
    joined with ' / '.
    """
    out: dict[str, str] = {}
    for entry in field_data or []:
        name = entry.get("name") or ""
        if not name:
            continue
        values = entry.get("values") or []
        out[name] = " / ".join(str(v) for v in values)
    return out


def _now_unix() -> int:
    return int(time.time())
