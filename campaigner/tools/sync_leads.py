"""
tools/sync_leads.py — mirror Meta Lead Form submissions into Postgres.

Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§5). For each Lead Form attached to the business's Page, pulls submissions
from Meta and upserts into `leads`. Idempotent on `(business_id, meta_lead_id)`.

Default window is the last 60 days; `--since-days` overrides. Daily cron runs
this with `--since-days 7` for incremental sync; the operator can trigger a
full backfill from `/leads` with `--since-days 365`.

Output: summary JSON `{business_id, forms_seen, leads_synced, leads_inserted,
leads_updated, errors}`.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.lib.lead_fetching import (
    LeadFetchError,
    fetch_leads_for_form,
    flatten_field_data,
    list_lead_forms,
)
from campaigner.lib.page_tokens import TokenLookupError, get_fb_publishing_target
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _parse_meta_ts(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _to_jsonb(v):
    return json.dumps(v) if v is not None else None


def _upsert_lead(cur, business_id: str, page_id: str, lead: dict) -> str:
    """Insert/refresh one lead row. Returns 'inserted' | 'updated' for stats."""
    meta_lead_id = str(lead.get("id"))
    flat = flatten_field_data(lead.get("field_data"))

    # Common field aliases — Meta lets the form designer pick the question key,
    # so we try the standard names plus the Hebrew aliases Aiweon's form uses.
    full_name = flat.get("full_name") or flat.get("שם_מלא") or flat.get("name")
    email = flat.get("email") or flat.get('דוא"ל') or flat.get("דואל")
    phone = flat.get("phone_number") or flat.get("phone") or flat.get("מספר_טלפון")
    city = flat.get("city") or flat.get("עיר")

    cur.execute(
        """
        INSERT INTO leads (
            business_id, meta_lead_id, meta_form_id,
            meta_ad_id, meta_adset_id, meta_campaign_id, meta_page_id,
            kind, full_name, email, phone, city,
            field_data, custom_disclaimer_responses, is_organic,
            ad_creative_id, meta_created_at, meta_raw,
            synced_at, archived_at
        )
        VALUES (
            %(business_id)s, %(meta_lead_id)s, %(meta_form_id)s,
            %(ad_id)s, %(adset_id)s, %(campaign_id)s, %(page_id)s,
            'form_lead', %(full_name)s, %(email)s, %(phone)s, %(city)s,
            %(field_data)s, %(disclaimer)s, %(is_organic)s,
            %(creative_id)s, %(created_at)s, %(meta_raw)s,
            now(), NULL
        )
        ON CONFLICT (business_id, meta_lead_id) DO UPDATE SET
            meta_form_id = COALESCE(EXCLUDED.meta_form_id, leads.meta_form_id),
            meta_ad_id = COALESCE(EXCLUDED.meta_ad_id, leads.meta_ad_id),
            meta_adset_id = COALESCE(EXCLUDED.meta_adset_id, leads.meta_adset_id),
            meta_campaign_id = COALESCE(EXCLUDED.meta_campaign_id, leads.meta_campaign_id),
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            city = EXCLUDED.city,
            field_data = EXCLUDED.field_data,
            custom_disclaimer_responses = EXCLUDED.custom_disclaimer_responses,
            is_organic = EXCLUDED.is_organic,
            meta_raw = EXCLUDED.meta_raw,
            synced_at = now(),
            archived_at = NULL
        RETURNING (xmax = 0) AS inserted
        """,
        {
            "business_id": business_id,
            "meta_lead_id": meta_lead_id,
            "meta_form_id": lead.get("form_id"),
            "ad_id": lead.get("ad_id"),
            "adset_id": lead.get("adset_id"),
            "campaign_id": lead.get("campaign_id"),
            "page_id": page_id,
            "full_name": full_name,
            "email": email,
            "phone": phone,
            "city": city,
            "field_data": _to_jsonb(lead.get("field_data")),
            "disclaimer": _to_jsonb(lead.get("custom_disclaimer_responses")),
            "is_organic": lead.get("is_organic"),
            "creative_id": lead.get("ad_creative_id"),
            "created_at": _parse_meta_ts(lead.get("created_time")),
            "meta_raw": _to_jsonb(lead),
        },
    )
    row = cur.fetchone()
    return "inserted" if (row and row.get("inserted")) else "updated"


def _sync(business_id: str, since_days: int, max_leads_per_form: int) -> dict:
    try:
        page_id, token = get_fb_publishing_target(business_id)
    except TokenLookupError as e:
        emit_validation_error(f"page token lookup failed: {e}")
        return {}  # unreachable

    errors: list[str] = []
    try:
        forms = list_lead_forms(page_id, token)
    except LeadFetchError as e:
        emit_runtime_error(f"list_lead_forms failed: {e}", e)
        return {}  # unreachable

    since_unix = int(time.time()) - since_days * 86400 if since_days > 0 else None

    leads_synced = 0
    leads_inserted = 0
    leads_updated = 0

    def _do_writes(form_leads: list[dict]) -> tuple[int, int]:
        ins = 0
        upd = 0
        with get_connection() as conn, conn.cursor() as cur:
            for lead in form_leads:
                try:
                    res = _upsert_lead(cur, business_id, page_id, lead)
                    if res == "inserted":
                        ins += 1
                    else:
                        upd += 1
                except Exception as e:
                    errors.append(f"upsert lead {lead.get('id')} failed: {e!r}")
        return ins, upd

    for form in forms:
        form_id = str(form.get("id"))
        try:
            form_leads = fetch_leads_for_form(
                form_id,
                token,
                since_unix=since_unix,
                max_leads=max_leads_per_form,
            )
        except LeadFetchError as e:
            errors.append(f"fetch leads for form {form_id} failed: {e}")
            continue
        leads_synced += len(form_leads)
        try:
            ins, upd = with_db_retry(lambda fl=form_leads: _do_writes(fl))
        except Exception as e:
            errors.append(f"DB writes for form {form_id} failed: {e!r}")
            continue
        leads_inserted += ins
        leads_updated += upd

    return {
        "business_id": business_id,
        "page_id": page_id,
        "forms_seen": len(forms),
        "leads_synced": leads_synced,
        "leads_inserted": leads_inserted,
        "leads_updated": leads_updated,
        "since_days": since_days,
        "errors": errors,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Sync Meta Lead Form submissions into the local leads table."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--since-days",
        type=int,
        default=60,
        help="How many days back to pull (default 60). 0 = no filter (full history).",
    )
    p.add_argument(
        "--max-leads-per-form",
        type=int,
        default=500,
        help="Hard cap on leads per form per sync to bound runtime.",
    )
    args = p.parse_args()

    try:
        Config.load().require_meta()
    except ConfigError as e:
        emit_validation_error(f"Meta config missing: {e}")
        return

    try:
        summary = _sync(
            args.business_id,
            since_days=args.since_days,
            max_leads_per_form=args.max_leads_per_form,
        )
    except Exception as e:
        emit_runtime_error(f"sync failed: {e}", e)
        return

    emit_success(summary)


if __name__ == "__main__":
    main()
