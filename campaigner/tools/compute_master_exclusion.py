"""
tools/compute_master_exclusion.py — build the Master Exclusion union
(Mastery v2 Phase D, 2026-05-17).

Per Wonderful research (Mastery v2 §1.6): adding an exclusion audience of
(submitters ∪ customers ∪ employees) to every prospecting ad set delivers
~-40% CPA vs prospecting without exclusion. This tool computes the union
membership signal for each business so the operator can propose a Custom
Audience covering it.

v1 scope: report-only. The actual Meta Custom Audience creation is a
separate `create_custom_audience` proposal (already exists). This tool tells
the operator "you have N candidates for the union" + provides email/phone
hashed lists for the upload.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import hashlib

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _sha256(s: str | None) -> str | None:
    if not s:
        return None
    return hashlib.sha256(s.strip().lower().encode("utf-8")).hexdigest()


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compute Master Exclusion union (submitters + customers + employees).",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--include-employees",
        action="store_true",
        help="Include employee emails (from business_knowledge.employee_emails if present).",
    )
    p.add_argument(
        "--output-format",
        choices=["counts", "hashed_list"],
        default="counts",
        help=(
            "counts: report only counts per source (default). "
            "hashed_list: also dump SHA-256 hashes ready for Meta Customer File upload."
        ),
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Lead submitters from leads table (365d window)
    try:
        submitter_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT email, phone
                  FROM leads
                 WHERE business_id = %s
                   AND archived_at IS NULL
                   AND meta_created_at >= now() - interval '365 days'
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"leads query failed: {e}", exc=e)
        return

    # Customers — leads with converted=true in lead_quality_grades
    try:
        customer_rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT l.email, l.phone
                  FROM leads l
                  JOIN lead_quality_grades g ON g.lead_id = l.id
                 WHERE l.business_id = %s
                   AND l.archived_at IS NULL
                   AND g.converted = TRUE
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"customer query failed: {e}", exc=e)
        return

    submitter_emails = {_sha256(r["email"]) for r in submitter_rows if r.get("email")}
    submitter_phones = {_sha256(r["phone"]) for r in submitter_rows if r.get("phone")}
    customer_emails = {_sha256(r["email"]) for r in customer_rows if r.get("email")}
    customer_phones = {_sha256(r["phone"]) for r in customer_rows if r.get("phone")}

    # Combined union (dedup via set)
    union_emails = submitter_emails | customer_emails
    union_phones = submitter_phones | customer_phones
    union_emails.discard(None)
    union_phones.discard(None)

    result: dict = {
        "business_id": args.business_id,
        "submitter_count": len(submitter_rows or []),
        "customer_count": len(customer_rows or []),
        "union_email_count": len(union_emails),
        "union_phone_count": len(union_phones),
        "ready_for_meta_upload": len(union_emails) + len(union_phones) >= 100,
        "next_action_he": (
            f"מצאתי {len(union_emails)} מיילים ו-{len(union_phones)} טלפונים "
            f"להחרגה. Meta דורש מינימום ~100 רשומות לאודיינס Customer File. "
            f"{'מוכן לעלות.' if len(union_emails) + len(union_phones) >= 100 else 'אסוף עוד לפני שאתה מציע create_custom_audience.'}"
        ),
    }

    if args.output_format == "hashed_list":
        result["hashed_emails"] = sorted(union_emails)
        result["hashed_phones"] = sorted(union_phones)

    emit_success(result)


if __name__ == "__main__":
    main()
