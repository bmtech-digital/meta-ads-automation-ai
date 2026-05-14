"""
tools/mark_failed.py — mark an approval as failed with an error message.

Flow B calls this when execute_task returns error, or when recheck_guardrails
fails on a re-evaluated proposal.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)


def main() -> None:
    p = argparse.ArgumentParser(description="Mark an approval as failed and record the error.")
    p.add_argument("--approval-id", required=True)
    p.add_argument("--error", required=True, help="short error message")
    p.add_argument("--details", default=None, help="optional JSON with execution_result details")
    args = p.parse_args()

    if not args.error.strip():
        emit_validation_error("--error must be non-empty")

    details = parse_json_arg(args.details, "details")

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    def _update() -> dict | None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE approvals
                   SET status = 'failed',
                       executed_at = now(),
                       execution_result = COALESCE(execution_result, '{}'::jsonb)
                                          || jsonb_build_object('error', %s::text,
                                                                'details', %s::jsonb)
                 WHERE id = %s
                   AND status NOT IN ('executed', 'failed')
                RETURNING id, status, executed_at
                """,
                (
                    args.error.strip(),
                    json.dumps(details) if details is not None else None,
                    args.approval_id,
                ),
            )
            return cur.fetchone()

    try:
        row = with_db_retry(_update)
    except Exception as e:
        emit_runtime_error(f"mark_failed update failed: {e}", exc=e)
        return

    if row is None:
        emit_validation_error(
            f"approval {args.approval_id} not found, already executed, or already failed"
        )
        return

    emit_success(
        {
            "approval_id": str(row["id"]),
            "status": row["status"],
            "executed_at": row["executed_at"].isoformat(),
            "error": args.error.strip(),
        }
    )


if __name__ == "__main__":
    main()
