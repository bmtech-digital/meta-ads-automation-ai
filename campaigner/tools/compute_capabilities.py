"""
tools/compute_capabilities.py — emit the agent's exercisable capabilities
for the upcoming run.

Wraps `campaigner.lib.capabilities.compute_capabilities`. Invoked at the
top of `daily_observe_propose.sh` (and other runners) so the JSON shape can
be piped into the `claude -p` invocation. The agent reads it as a fact —
"these are the actions you may propose this run" — instead of re-deriving
the premise checks inside the LLM (which it was getting wrong; see
docs/todos/capability-gated-decision-flow.md).

This tool reads only state the agent would already have gathered later in
the run (tracking_health, account_health, businesses, business_knowledge,
optional latest kpi research). It does NOT call Meta. It does NOT call the
LLM. Pure DB + the pure-function decision in `lib.capabilities`.

Output (stdout, single JSON object):

  {
    "business_id": "...",
    "computed_at":  "...ISO...",
    "capabilities": [
      {"name":"scale_up", "available": false,
       "blocked_by":["tracking_verified"], "reason_he":"..."},
      ...
    ],
    "blocked_count": 4,
    "available_count": 9
  }

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json as _json
import subprocess
import sys
from datetime import UTC, datetime
from typing import Any

from campaigner.lib.capabilities import compute_capabilities
from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _run_tool(tool: str, args: list[str]) -> dict | None:
    """Invoke another tool via `python -m campaigner.tools.<tool>` and
    return its parsed JSON output. Returns None on failure (logged to
    stderr — capability computation must not abort just because one
    upstream check is flaky)."""
    try:
        proc = subprocess.run(
            [sys.executable, "-m", f"campaigner.tools.{tool}", *args],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        print(f"compute_capabilities: {tool} invocation failed: {exc}", file=sys.stderr)
        return None
    if proc.returncode != 0:
        print(
            f"compute_capabilities: {tool} exited {proc.returncode}: {proc.stderr.strip()}",
            file=sys.stderr,
        )
        return None
    try:
        return _json.loads(proc.stdout)
    except _json.JSONDecodeError as exc:
        print(f"compute_capabilities: {tool} produced non-JSON stdout: {exc}", file=sys.stderr)
        return None


def _load_business_row(business_id: str) -> dict[str, Any] | None:
    return with_db_retry(
        lambda: fetch_one(
            """
            SELECT id::text AS id,
                   name,
                   primary_kpi,
                   target_cpa_ils,
                   target_cpl_ils,
                   target_roas,
                   onboarding_status
              FROM businesses
             WHERE id = %s
            """,
            (business_id,),
        )
    )


def _load_latest_kpi_research(business_id: str, kpi: str | None) -> dict | None:
    """Latest set_kpi_target research payload — extracted from the most
    recent `approvals.payload->'research'` row whose task_type='set_kpi_target'
    for this business + KPI. Mirrors web/getLatestKpiResearch semantics."""
    if not kpi:
        return None
    row = with_db_retry(
        lambda: fetch_one(
            """
            SELECT payload
              FROM approvals
             WHERE business_id = %s
               AND task_type = 'set_kpi_target'
               AND payload->>'kpi' = %s
               AND status IN ('pending', 'approved', 'executed')
             ORDER BY created_at DESC
             LIMIT 1
            """,
            (business_id, kpi),
        )
    )
    if not row:
        return None
    payload = row.get("payload") or {}
    return payload.get("research")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Emit the agent's exercisable capabilities for the upcoming run."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--skip-tool-shells",
        action="store_true",
        help=(
            "Read state directly from Postgres instead of shelling to "
            "check_tracking_health.py / check_account_health.py. Used in tests "
            "and when the runner has already cached those outputs. (Default: shell out.)"
        ),
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        biz = _load_business_row(args.business_id)
    except Exception as e:  # noqa: BLE001
        emit_runtime_error(f"businesses fetch failed: {e}", exc=e)
        return
    if not biz:
        emit_validation_error(f"business not found: {args.business_id}")
        return

    if args.skip_tool_shells:
        tracking_health = None
        account_health = None
    else:
        tracking_health = _run_tool("check_tracking_health", ["--business-id", args.business_id])
        account_health = _run_tool("check_account_health", ["--business-id", args.business_id])

    try:
        kpi_research = _load_latest_kpi_research(args.business_id, biz.get("primary_kpi"))
    except Exception as e:  # noqa: BLE001
        print(f"compute_capabilities: kpi research lookup failed: {e}", file=sys.stderr)
        kpi_research = None

    state: dict[str, Any] = {
        "business": biz,
        "tracking_health": tracking_health,
        "account_health": account_health,
        "kpi_research": kpi_research,
        # campaign_state is intentionally absent at run-start — per-capability
        # gates like utilization/ab_test_age fall back to "unknown → pass"
        # so the agent can route per-campaign with real data later.
        "campaign_state": None,
    }

    report = compute_capabilities(state)
    payload = {
        "business_id": args.business_id,
        "computed_at": datetime.now(UTC).isoformat(),
        **report.to_dict(),
    }
    # Provenance hints — useful for debugging "why is tracking_verified blocked?"
    payload["state_summary"] = {
        "tracking_status": (tracking_health or {}).get("status"),
        "account_health_band": (account_health or {}).get("health_band"),
        "primary_kpi": biz.get("primary_kpi"),
        "kpi_research_present": kpi_research is not None,
    }
    emit_success(payload)


if __name__ == "__main__":
    main()
