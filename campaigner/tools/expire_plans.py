"""
tools/expire_plans.py — flip pending plans_carryover rows past their TTL to
`status='expired'`. Cron-friendly cleanup so the audit trail stays readable.

Built 2026-05-13 PM with migration 023. Without this, expired plans linger
as `status='pending'` even though every read path filters by
`expires_at > now()` — query results stay correct but the operator-facing
view shows confusing "open" plans that are actually dead.

Invoked: nightly cron, or inline at the end of Flow A. Idempotent.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.lib import plans as _plans
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Mark expired plans_carryover rows. Idempotent.",
    )
    # business-id is accepted for symmetry with other tools (heartbeat /
    # log_decision contexts) but the cleanup itself is global — it flips
    # every business's expired pending rows at once.
    p.add_argument("--business-id", default=None)
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        with get_connection() as conn:
            updated = _plans.mark_expired_old_rows(conn)
    except Exception as e:
        emit_runtime_error(f"expire_plans failed: {e}", exc=e)
        return

    emit_success({
        "business_id": args.business_id,
        "expired_count": updated,
    })


if __name__ == "__main__":
    main()
