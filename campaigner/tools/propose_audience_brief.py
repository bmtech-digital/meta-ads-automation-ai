"""
tools/propose_audience_brief.py — emit an audience_brief approval as step 2
of the Onboarding Flow F (Mastery v2 Phase A, 2026-05-17).

Triggered by onboarding_chain.sh after the business brief is filled. Prefills
geo from business_knowledge.geo_targeting + service_regions and asks the
operator to confirm + add exclusions. Per project policy (memory:
feedback_targeting_owned_by_user) the agent NEVER proposes interest targeting.

The approval carries:
- operator_questions: MCQ asking confirm-geo / add-exclusions / skip-interests
- payload: {step, prefill_geo, target_url='/audiences', acknowledgment_only}

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _summarize_geo(geo_targeting: dict | None, service_regions: list | None) -> str:
    """Pull a Hebrew one-line description of the prefilled geo for the rationale."""
    if isinstance(geo_targeting, dict):
        include = geo_targeting.get("include") or {}
        cities = include.get("cities") or []
        if cities:
            names = [c.get("name") if isinstance(c, dict) else str(c) for c in cities[:5]]
            return f"ערים: {', '.join(filter(None, names))}"
        countries = include.get("countries") or []
        if countries:
            return f"מדינות: {', '.join(countries)}"
    if service_regions:
        return f"אזורי שירות מהבריף: {', '.join(service_regions[:5])}"
    return "ברירת מחדל: כל ישראל"


def _rationale(business_name: str, geo_summary: str) -> str:
    return (
        f"שלב 2 באונבורדינג — בריף קהל.\n"
        f"\n"
        f"מילאת את הבריף העסקי. עכשיו אני צריך לאשר איתך את הקהל הראשוני "
        f"לפני שאני מציע קמפיין.\n"
        f"\n"
        f"מילאתי מראש את הגיאוגרפיה לפי הבריף שלך: {geo_summary}.\n"
        f"\n"
        f"שים לב: בחירת קהלי עניין (Interests, Lookalikes) היא באחריותך ולא שלי. "
        f"אני יכול לעזור עם גיאוגרפיה, גילאים, והחרגות — בלבד.\n"
        f"\n"
        f"אישור = רואים. עבור ל-/audiences להוסיף החרגות (לדוגמה: לקוחות "
        f"קיימים, עובדים) או לעדכן את הגיאוגרפיה.\n"
        f"\n"
        f"תוכנית:\n"
        f"1. אשר את ההצעה הזו לאחר שאישרת את הגיאוגרפיה ב-/audiences\n"
        f"2. אני אסרוק את הגלריה והפוסטים האורגניים שלך\n"
        f"3. אציע קמפיין ראשון מלא לאישור"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Emit an audience_brief approval (step 2 of onboarding chain).",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--run-id", required=True)
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        row = with_db_retry(
            lambda: fetch_one(
                """
                SELECT b.id, b.name, bk.geo_targeting, bk.service_regions
                  FROM businesses b
             LEFT JOIN business_knowledge bk ON bk.business_id = b.id
                 WHERE b.id = %s
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business lookup failed: {e}", exc=e)
        return
    if not row:
        emit_validation_error(f"business {args.business_id} not found")
        return

    geo_summary = _summarize_geo(row.get("geo_targeting"), row.get("service_regions"))
    rationale = _rationale(row["name"], geo_summary)
    payload = {
        "step": "audience_brief",
        "target_url": "/audiences",
        "prefill_geo": row.get("geo_targeting"),
        "prefill_regions": row.get("service_regions"),
        "acknowledgment_only": True,
    }
    operator_questions = [
        {
            "id": "geo_confirmed",
            "prompt_he": "האם הגיאוגרפיה שמילאתי מראש מתאימה?",
            "options": [
                {"value": "yes", "label_he": "כן, ממשיך"},
                {"value": "edit", "label_he": "צריך לעדכן ב-/audiences"},
                {"value": "default_il", "label_he": "בלי גיאוגרפיה ספציפית — כל ישראל"},
            ],
            "required": True,
        },
    ]

    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "campaigner.tools.propose_task",
            "--business-id",
            args.business_id,
            "--run-id",
            args.run_id,
            "--task-type",
            "audience_brief",
            "--payload",
            json.dumps(payload),
            "--rationale",
            rationale,
            "--urgency",
            "high",
            "--expires-in-hours",
            "168",
            "--operator-questions",
            json.dumps(operator_questions),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        emit_runtime_error(f"propose_task failed: {proc.stderr.strip() or proc.stdout.strip()}")
        return

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        emit_runtime_error(f"propose_task returned invalid JSON: {e}")
        return

    # See propose_business_brief.py — emit_success writes data directly to
    # stdout; approval_id is top-level, not nested under "data".
    emit_success(
        {
            "step": "audience_brief",
            "approval_id": result.get("approval_id"),
            "business_id": args.business_id,
            "geo_summary": geo_summary,
        }
    )


if __name__ == "__main__":
    main()
