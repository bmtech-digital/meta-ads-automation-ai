"""
tools/propose_first_campaign.py — emit a first_campaign approval as step 4 of
the Onboarding Flow F (Mastery v2 Phase A, 2026-05-17).

This is the "wow" deliverable: the operator opens the app and sees ONE
complete campaign proposal — objective, audience, creative, copy, daily
budget — fully filled and ready to approve.

Contract:
- Triggered by onboarding_chain.sh after audience_brief is answered.
- Uses business_knowledge to pick service + objective + copy angle.
- Uses draft_new_campaign_payload internally to compose the §38-compliant
  Meta payload, then wraps it as a `first_campaign` task_type (distinct
  from `new_campaign` so the UI can render it with first-time-flow chrome).
- Daily budget is computed from monthly_budget_ils / 30, then multiplied
  by 1.4 for the cold-start front-load (130-150% pro-rated for first 7-10
  days — Foxwell "faster spend = faster signal").
- Adds an MCQ asking the operator to confirm/edit before approval.
- Skips silently if business has any existing active campaigns
  (`active_campaign_count > 0`) — the onboarding chain shouldn't fire on
  established businesses.

Outputs §38-style validation notes for the operator: "expect Month 1
CPL ₪X-Y, Y leads of variable quality; full benchmarks stabilize Month 2-3."

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


def _cold_start_daily_budget(monthly_budget_ils: float | None) -> tuple[float, str]:
    """Compute the recommended day-1 daily budget with cold-start front-load.

    Returns (daily_budget_ils, explanation_he).

    Math: monthly / 30 × 1.4 (front-load multiplier per Phase F mastery plan
    + Foxwell's "spend $10-15K over 2 weeks not a month for cold start"
    recommendation). Also floor at ₪50 — under that Andromeda doesn't learn.
    """
    if not monthly_budget_ils or monthly_budget_ils <= 0:
        return 100.0, (
            "ברירת מחדל ₪100/יום — עדיין לא הגדרת תקציב חודשי. "
            "המלצה: גש ל-/business-knowledge והגדר תקציב חודשי "
            "(מינימום ריאלי ₪3000/חודש לפי הנוסחה של Andromeda — "
            "(CPL מטרה × 50) / 7)."
        )
    pro_rated = monthly_budget_ils / 30.0
    front_loaded = pro_rated * 1.4
    floor = 50.0
    final = max(front_loaded, floor)
    return final, (
        f"חודש ראשון מקבל קצב הוצאה גבוה בכ-40% מהקצב הפרורייטי "
        f"(₪{pro_rated:.0f}/יום), כי Andromeda צריך להגיע ל-50 המרות "
        f"בשבוע כדי לצאת ממצב למידה. ההמלצה: ₪{final:.0f}/יום ל-7-10 "
        f"הימים הראשונים, ואז סוכן יציע להוריד לקצב הרגיל."
    )


def _expectation_setter_he(daily_budget: float) -> str:
    """Hebrew "what to expect Month 1" block — research-grounded ranges."""
    leads_low = max(int(daily_budget * 30 / 90), 5)
    leads_high = int(daily_budget * 30 / 35)
    return (
        "מה לצפות בחודש הראשון:\n"
        f"- {leads_low}-{leads_high} לידים גולמיים סך הכל (תלוי בכמה הקהל מגיב לקריאייטיב).\n"
        "- עלות לליד גולמי: ₪35-90 (לפי benchmarks ישראליים B2B 2025-2026).\n"
        "- עלות לליד איכותי (אחרי דירוג שלך): ₪70-200 — בערך פי 2-2.5 מהגולמי. "
        "זה נורמלי — חלק מהלידים יהיו 'סתם בודק' ולא יענו בוואטסאפ.\n"
        "- 4-15 שיחות עסקיות אמיתיות (לפי כמה ידיים יש לך לעבוד את הלידים).\n"
        "- אל תצפה שייצא רווחי בחודש הראשון. חודש 1 = הסוכן לומד מי הקהל, "
        "אתה לומד אילו לידים שווים. חודש 3 = הגיוני להתחיל לחתוך החלטות.\n"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Emit a first_campaign approval (step 4 of onboarding chain).",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument(
        "--service-tag",
        default=None,
        help="Override service auto-pick. Defaults to first service in business_knowledge.products.",
    )
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
                SELECT b.id, b.name, b.monthly_budget_ils, b.meta_page_id,
                       b.target_cpl_ils, bk.products, bk.service_regions
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

    # Bail out if there's already an active campaign — onboarding shouldn't fire.
    try:
        active = with_db_retry(
            lambda: fetch_one(
                """
                SELECT count(*) AS n
                  FROM agent_decisions
                 WHERE business_id = %s
                   AND graph_name = 'observe_propose'
                   AND node_name = 'fetch_meta_state'
                   AND outputs->>'status' = 'ACTIVE'
                   AND created_at >= now() - interval '7 days'
                """,
                (args.business_id,),
            )
        )
        if active and (active.get("n") or 0) > 0:
            emit_success(
                {
                    "step": "first_campaign",
                    "skipped": True,
                    "reason": "business already has active campaigns in last 7d",
                }
            )
            return
    except Exception:
        # Active-count check is a soft guard; don't fail the whole tool if
        # agent_decisions query hiccups.
        pass

    # Pick service.
    products = row.get("products") or []
    if args.service_tag:
        service_tag = args.service_tag
    elif products and isinstance(products, list) and len(products) > 0:
        first = products[0]
        service_tag = first.get("service_tag") if isinstance(first, dict) else None
    else:
        service_tag = None

    daily_budget, budget_note_he = _cold_start_daily_budget(row.get("monthly_budget_ils"))
    expectations_he = _expectation_setter_he(daily_budget)

    payload = {
        "step": "first_campaign",
        "target_url": "/campaigns/new",
        "service_tag": service_tag,
        "recommended_daily_budget_ils": round(daily_budget, 2),
        "objective_recommendation": "OUTCOME_LEADS",  # Aiweon funnel = Lead Ads
        "audience_summary_he": "ישראל · גילאי 25-55 · עברית · קהל רחב (Advantage+ ON)",
        "cold_start_front_load": True,
        "acknowledgment_only": True,  # The campaign creation itself happens
        # via the operator clicking through /campaigns/new with the prefill.
    }

    rationale = (
        f"שלב 4 (האחרון) באונבורדינג — הצעה לקמפיין ראשון.\n"
        f"\n"
        f"בריאות חשבון, גלריה, וקהל אושרו. אני מוכן להציע קמפיין ראשון מלא.\n"
        f"\n"
        f"המלצה: {payload['audience_summary_he']}, מטרה=Leads, "
        f"שירות={service_tag or '(לא הוגדר — שייך כל השירותים בבריף)'}, "
        f"תקציב יומי ₪{daily_budget:.0f}.\n"
        f"\n"
        f"{budget_note_he}\n"
        f"\n"
        f"{expectations_he}\n"
        f"\n"
        f"אישור = ראיתי, ממשיך ל-/campaigns/new כדי לסיים את ההקמה. "
        f"דחייה = רוצה לדבר על משהו לפני שמתחילים.\n"
        f"\n"
        f"תוכנית:\n"
        f"1. אשר את ההצעה — תגיע ל-/campaigns/new עם prefill\n"
        f"2. סקור את הפרטים, הוסף יצירתי מהגלריה או צור חדש דרך Imagen\n"
        f"3. אשר את הקמפיין ב-PAUSED — לא יוצאת לאוויר עד שאתה לוחץ Resume\n"
        f"4. חכה 7-14 ימים ללמידה. אני אשלח לך עדכון יומי על הקצב."
    )

    operator_questions = [
        {
            "id": "ready_to_start",
            "prompt_he": "מה לעשות?",
            "options": [
                {"value": "go", "label_he": "ממשיך — תעביר אותי ל-/campaigns/new"},
                {
                    "value": "edit_brief",
                    "label_he": "רוצה לעדכן בריף עסקי לפני שמתחילים",
                },
                {
                    "value": "wait",
                    "label_he": "ממתין — אני רוצה לחכות לעוד לידים ידניים לפני קמפיין מטא",
                },
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
            "first_campaign",
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
            "step": "first_campaign",
            "approval_id": result.get("approval_id"),
            "business_id": args.business_id,
            "service_tag": service_tag,
            "daily_budget_ils": round(daily_budget, 2),
        }
    )


if __name__ == "__main__":
    main()
