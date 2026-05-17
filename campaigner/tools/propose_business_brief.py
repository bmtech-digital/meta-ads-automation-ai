"""
tools/propose_business_brief.py — emit a fill_business_brief approval as
step 1 of the Onboarding Flow F (Mastery v2 Phase A, 2026-05-17).

Run by `onboarding_chain.sh` immediately after Meta OAuth completes. The
approval is acknowledgment-style: the operator sees a card that explains
what's needed and links them to /business-knowledge to fill in the brief.

This tool is intentionally thin — the actual brief lives in
`business_knowledge` and is edited via the existing /business-knowledge UI.
The approval here is the *invitation* to fill it, not the storage.

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


def _rationale(business_name: str) -> str:
    """Hebrew plain-language rationale per hebrew-copy-style.md §11."""
    return (
        f"ברוכים הבאים, {business_name}!\n"
        "\n"
        "לפני שאני יכול להמליץ על קמפיין ראשון, אני צריך להכיר את העסק שלך. "
        'עבור ל"בריף עסקי" ומלא את הפרטים הבסיסיים: השירותים שאתה מציע, '
        "אזורי השירות, התקציב החודשי שאתה מוכן להשקיע, ועל מי הלקוחות שלך. "
        "זה לוקח כ-5 דקות.\n"
        "\n"
        "אישור = רואים. הסוכן יחכה למילוי הבריף לפני שימשיך לשלב הבא "
        "(הקהל, ואז ההצעה לקמפיין הראשון).\n"
        "\n"
        "תוכנית:\n"
        "1. מלא את הבריף ב-/business-knowledge\n"
        "2. אני אסרוק את החשבון שלך ב-Meta (גלריה, בריאות חשבון)\n"
        "3. אציע לך קהל ראשון\n"
        "4. אציע לך קמפיין ראשון מלא — מטרה, תקציב יומי, יצירתי, קופי"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Emit a fill_business_brief approval (step 1 of onboarding chain).",
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
            lambda: fetch_one("SELECT id, name FROM businesses WHERE id = %s", (args.business_id,))
        )
    except Exception as e:
        emit_runtime_error(f"business lookup failed: {e}", exc=e)
        return
    if not biz:
        emit_validation_error(f"business {args.business_id} not found")
        return

    business_name = biz["name"]
    payload = {
        "step": "fill_business_brief",
        "target_url": "/business-knowledge",
        "acknowledgment_only": True,
    }
    rationale = _rationale(business_name)

    # Delegate to propose_task — single insertion path, single guardrail
    # surface. We shell out to keep the propose_task argparse surface canonical.
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
            "fill_business_brief",
            "--payload",
            json.dumps(payload),
            "--rationale",
            rationale,
            "--urgency",
            "high",
            "--expires-in-hours",
            "168",  # 7 days — onboarding shouldn't time out aggressively
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

    # propose_task uses emit_success(data) which writes `data` directly to
    # stdout (no {ok,data} wrapper). approval_id sits at the top level.
    # Bug found 2026-05-17 — previous version returned approval_id=null
    # because it looked under result["data"], which doesn't exist.
    emit_success(
        {
            "step": "fill_business_brief",
            "approval_id": result.get("approval_id"),
            "business_id": args.business_id,
            "business_name": business_name,
        }
    )


if __name__ == "__main__":
    main()
