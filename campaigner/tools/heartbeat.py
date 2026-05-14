"""
tools/heartbeat.py — write a row to the `heartbeats` table.

Runners call this at start / end / error to populate the liveness table that
the frontend uses for "3 consecutive failures" alerts (spec §10.8).

Contract: §11.6 (JSON stdout, exit 0/1/2; DB retry on transient errors).

Example:
    python -m campaigner.tools.heartbeat \\
        --business-id "$BUSINESS_ID" \\
        --flow daily_observe_propose \\
        --phase start

    python -m campaigner.tools.heartbeat \\
        --business-id "$BUSINESS_ID" \\
        --flow daily_observe_propose \\
        --phase end \\
        --duration-ms 124500 \\
        --exit-code 0 \\
        --details '{"proposals_written":3,"rejections":1}'
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

VALID_PHASES = ("start", "end", "error")


def main() -> None:
    p = argparse.ArgumentParser(description="Insert a heartbeat row.")
    p.add_argument("--business-id", required=True)
    p.add_argument("--flow", required=True, help="e.g. daily_observe_propose")
    p.add_argument("--phase", required=True, choices=VALID_PHASES)
    p.add_argument("--duration-ms", type=int, default=None)
    p.add_argument("--exit-code", type=int, default=None)
    p.add_argument("--error-message", default=None)
    p.add_argument("--details", default=None, help="JSON object")
    args = p.parse_args()

    if args.phase == "end" and args.exit_code is None:
        args.exit_code = 0
    if args.phase == "error" and args.exit_code is None:
        args.exit_code = 1

    details = parse_json_arg(args.details, "details")
    if details is not None and not isinstance(details, dict | list):
        emit_validation_error("--details must be a JSON object or array")

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    def _insert() -> dict:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO heartbeats (
                    business_id, flow, phase, duration_ms, exit_code, error_message, details
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id, ran_at
                """,
                (
                    args.business_id,
                    args.flow,
                    args.phase,
                    args.duration_ms,
                    args.exit_code,
                    args.error_message,
                    json.dumps(details) if details is not None else None,
                ),
            )
            return cur.fetchone()

    try:
        row = with_db_retry(_insert)
    except Exception as e:
        emit_runtime_error(f"heartbeats insert failed: {e}", exc=e)
        return

    emit_success(
        {
            "id": str(row["id"]),
            "flow": args.flow,
            "phase": args.phase,
            "ran_at": row["ran_at"].isoformat(),
        }
    )


if __name__ == "__main__":
    main()
