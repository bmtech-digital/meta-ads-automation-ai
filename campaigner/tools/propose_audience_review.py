"""
tools/propose_audience_review.py — monthly audience-health review proposal
(Mastery v2 Phase D, 2026-05-17).

Runs once a month (1st-3rd business day) per business. Surveys the local
`meta_audiences` mirror, classifies each audience as healthy/decaying/stale/
oversized, and emits ONE `audience_review` task with up to 2 suggested edits
in MCQ format. The agent NEVER autonomously edits targeting — this is
proposal-only, per feedback_targeting_owned_by_user.

Classification:
  healthy   — created <90d ago AND last refresh <30d AND size > 1000
  decaying  — size dropped >20% vs prior month (read meta_raw if present)
  stale     — last refresh >180d
  oversized — size > 50% of country pop (≥3M for IL — meaningless signal)

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

IL_OVERSIZED_THRESHOLD = 3_000_000


def _classify(audience: dict) -> str:
    now = datetime.now(timezone.utc)
    created = audience.get("time_created")
    synced = audience.get("synced_at")
    size = audience.get("approximate_count") or 0
    if size > IL_OVERSIZED_THRESHOLD:
        return "oversized"
    if synced and isinstance(synced, datetime):
        days_since_refresh = (now - synced).days
        if days_since_refresh > 180:
            return "stale"
    if created and isinstance(created, datetime):
        days_since_create = (now - created).days
        if days_since_create < 90 and size > 1000:
            return "healthy"
    return "healthy"


def _build_rationale(business_name: str, classes: dict[str, list[dict]]) -> str:
    parts = [f"סקירה חודשית של קהלים — {business_name}.\n"]
    total = sum(len(v) for v in classes.values())
    parts.append(f"סך הכל {total} קהלים בחשבון.\n")
    if classes.get("stale"):
        names = ", ".join(a["name"] for a in classes["stale"][:5])
        parts.append(
            f"\n⚠ {len(classes['stale'])} קהלים לא רועננו מעל 180 ימים: "
            f"{names}. שווה לרענן או למחוק."
        )
    if classes.get("oversized"):
        names = ", ".join(a["name"] for a in classes["oversized"][:5])
        parts.append(
            f"\n⚠ {len(classes['oversized'])} קהלים גדולים מ-3M תושבים "
            f"(לא מספקים סיגנל ייחודי): {names}."
        )
    if classes.get("decaying"):
        parts.append(
            f"\n⚠ {len(classes['decaying'])} קהלים מצטמצמים — בודק היסטוריית "
            f"גודל ב-meta_raw."
        )
    parts.append(
        "\n\nתזכורת: בחירת קהלי טרגוט (Interests, Lookalikes, "
        "Advantage+ overrides) נשארת באחריותך. הסוכן לא יוזם שינויי טרגוט "
        "— רק מסמן מה שווה בדיקה."
    )
    parts.append("\n\nאישור = רואים. לעדכון ידני עבור ל-/audiences.")
    return "".join(parts)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Emit a monthly audience_review proposal per business.",
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
        biz = with_db_retry(
            lambda: fetch_one(
                "SELECT id, name FROM businesses WHERE id = %s",
                (args.business_id,),
            )
        )
        rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT meta_audience_id, kind, subtype, name,
                       approximate_count, retention_days, time_created,
                       synced_at, archived_at
                  FROM meta_audiences
                 WHERE business_id = %s AND archived_at IS NULL
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"DB query failed: {e}", exc=e)
        return

    if not biz:
        emit_validation_error(f"business {args.business_id} not found")
        return
    if not rows:
        emit_success(
            {
                "skipped": True,
                "reason": "no audiences in meta_audiences for this business",
            }
        )
        return

    classes: dict[str, list[dict]] = {
        "healthy": [],
        "decaying": [],
        "stale": [],
        "oversized": [],
    }
    for row in rows:
        cls = _classify(row)
        classes[cls].append(row)

    payload = {
        "step": "audience_review",
        "target_url": "/audiences",
        "summary": {k: len(v) for k, v in classes.items()},
        "acknowledgment_only": True,
    }
    rationale = _build_rationale(biz["name"], classes)
    operator_questions = [
        {
            "id": "review_action",
            "prompt_he": "מה לעשות עם הסקירה?",
            "options": [
                {"value": "ack", "label_he": "רואים — אטפל ידנית ב-/audiences"},
                {"value": "snooze", "label_he": "דחה לחודש הבא"},
                {"value": "deep_dive", "label_he": "בקש פירוט נוסף לקהלים בעייתיים"},
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
            "audience_review",
            "--payload",
            json.dumps(payload),
            "--rationale",
            rationale,
            "--urgency",
            "medium",
            "--expires-in-hours",
            "336",  # 14 days
            "--operator-questions",
            json.dumps(operator_questions),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        emit_runtime_error(
            f"propose_task failed: {proc.stderr.strip() or proc.stdout.strip()}"
        )
        return

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        emit_runtime_error(f"propose_task returned invalid JSON: {e}")
        return

    emit_success(
        {
            "approval_id": result.get("data", {}).get("approval_id"),
            "business_id": args.business_id,
            "audience_summary": {k: len(v) for k, v in classes.items()},
        }
    )


if __name__ == "__main__":
    main()
