"""
tools/recheck_guardrails.py — re-evaluate guardrails just before Flow B executes.

Between human approval and execution there can be 15-60 min of drift: campaign
state on Meta changes, daily caps get filled, a conversion arrives. This tool
fetches the approval row, invokes check_guardrails with fresh state, and
returns the same shape. If it fails, Flow B calls mark_failed and skips the
approval.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(description="Re-run guardrail checks against an approved approval.")
    p.add_argument("--approval-id", required=True)
    p.add_argument(
        "--state", default=None, help="JSON with live Meta state (learning_status, hook_rate, ...)"
    )
    args = p.parse_args()

    state = parse_json_arg(args.state, "state") or {}
    if not isinstance(state, dict):
        emit_validation_error("--state must be a JSON object")
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        row = with_db_retry(
            lambda: fetch_one(
                """
            SELECT id, business_id, task_type, target_kind, target_id,
                   payload, rationale, urgency, status
            FROM approvals
            WHERE id = %s
            """,
                (args.approval_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"approval fetch failed: {e}", exc=e)
        return

    if row is None:
        emit_validation_error(f"approval not found: {args.approval_id}")
        return
    if row["status"] != "approved":
        emit_validation_error(
            f"approval {args.approval_id} status='{row['status']}' — recheck applies to 'approved' only"
        )
        return

    proposal_json = {
        "task_type": row["task_type"],
        "target_kind": row["target_kind"],
        "target_id": row["target_id"],
        "payload": row["payload"],
        "rationale": row["rationale"],
        "urgency": row["urgency"],
    }

    # Delegate to check_guardrails as a subprocess so we re-use exactly one implementation.
    cmd = [
        sys.executable,
        "-m",
        "campaigner.tools.check_guardrails",
        "--business-id",
        str(row["business_id"]),
        "--proposal",
        json.dumps(proposal_json, default=str),
        "--state",
        json.dumps(state, default=str),
    ]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[2])
    )
    if proc.returncode != 0:
        emit_runtime_error(f"check_guardrails subprocess failed: {proc.stderr.strip()}", exc=None)
        return

    try:
        inner = json.loads(proc.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError as e:
        emit_runtime_error(f"check_guardrails returned non-JSON: {e}", exc=e)
        return

    emit_success(
        {
            "approval_id": args.approval_id,
            "rechecked_against_state": bool(state),
            **inner,
        }
    )


if __name__ == "__main__":
    main()
