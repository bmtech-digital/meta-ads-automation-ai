"""
tools/log_decision.py — insert a row into `agent_decisions`.

Every phase of every flow MUST call this at least once (spec §12.1). Missing
a log = silent audit-trail gap; per the fail-hard design (see conversation
log), this tool exits 1 on DB failure after retrying transient errors.

Exit codes per contract §11.6 (0 / 1 / 2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.lib.thresholds import SCHEMA_VERSION as THRESHOLDS_SCHEMA_VERSION
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)

VALID_DECISION_TYPES = (
    "observation",
    # Added 2026-05-25 (Migration 033): the agent identified a finding but the
    # capability required to act is blocked. The diagnosis is surfaced; no
    # approval is created. Carries outputs.finding_type + outputs.blocked_by +
    # outputs.would_propose so the UI can render "ready when you unblock me."
    "observation_blocked",
    "diagnosis",
    "proposal",
    "rejection",
    "skip",
    "execution",
    "error",
)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Log a single decision row into agent_decisions.",
    )
    # required
    p.add_argument("--business-id", required=True)
    p.add_argument("--run-id", required=True, help="Groups rows from a single Claude invocation")
    p.add_argument(
        "--graph-name", required=True, help="e.g. observe_propose | execute | onboarding"
    )
    p.add_argument(
        "--node-name",
        required=True,
        help="Logical phase (e.g. observe, diagnose, apply_guardrails)",
    )
    p.add_argument("--decision-type", required=True, choices=VALID_DECISION_TYPES)
    p.add_argument("--summary", required=True, help="One-line human-readable")

    # optional text
    p.add_argument("--rationale", default=None)

    # optional JSON
    p.add_argument("--inputs", default=None, help="JSON dict of signals fed into the decision")
    p.add_argument("--outputs", default=None, help="JSON dict of what it produced")

    # optional FKs / refs
    p.add_argument("--related-approval-id", default=None)
    p.add_argument("--campaign-id", default=None)
    p.add_argument("--adset-id", default=None)
    p.add_argument("--ad-id", default=None)

    # optional LLM metadata
    p.add_argument("--llm-model", default=None)
    p.add_argument("--llm-tokens-in", type=int, default=None)
    p.add_argument("--llm-tokens-out", type=int, default=None)
    p.add_argument("--latency-ms", type=int, default=None)

    # optional rejection metadata
    p.add_argument(
        "--guardrail-violations",
        default=None,
        help="Comma-separated list of violation codes (e.g. 'no_learning_phase_touch,budget_jump_cap')",
    )
    p.add_argument("--confidence", type=float, default=None, help="LLM self-confidence 0..1")

    args = p.parse_args()

    # Validation
    if args.confidence is not None and not (0.0 <= args.confidence <= 1.0):
        emit_validation_error(f"--confidence must be in [0, 1] (got {args.confidence})")

    inputs = parse_json_arg(args.inputs, "inputs")
    if inputs is not None and not isinstance(inputs, dict | list):
        emit_validation_error("--inputs must be a JSON object or array")
    outputs = parse_json_arg(args.outputs, "outputs")
    if outputs is not None and not isinstance(outputs, dict | list):
        emit_validation_error("--outputs must be a JSON object or array")

    violations = None
    if args.guardrail_violations:
        violations = [v.strip() for v in args.guardrail_violations.split(",") if v.strip()]

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    import json as _json  # local alias to avoid shadowing

    def _do_insert() -> dict:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_decisions (
                    business_id, run_id, graph_name, node_name, decision_type,
                    summary, rationale, inputs, outputs,
                    related_approval_id, campaign_id, adset_id, ad_id,
                    llm_model, llm_tokens_in, llm_tokens_out, latency_ms,
                    guardrail_violations, confidence,
                    thresholds_schema_version
                )
                VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s::jsonb, %s::jsonb,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s
                )
                RETURNING id, created_at
                """,
                (
                    args.business_id,
                    args.run_id,
                    args.graph_name,
                    args.node_name,
                    args.decision_type,
                    args.summary,
                    args.rationale,
                    _json.dumps(inputs) if inputs is not None else None,
                    _json.dumps(outputs) if outputs is not None else None,
                    args.related_approval_id,
                    args.campaign_id,
                    args.adset_id,
                    args.ad_id,
                    args.llm_model,
                    args.llm_tokens_in,
                    args.llm_tokens_out,
                    args.latency_ms,
                    violations,
                    args.confidence,
                    THRESHOLDS_SCHEMA_VERSION,
                ),
            )
            return cur.fetchone()

    try:
        row = with_db_retry(_do_insert)
    except Exception as e:
        emit_runtime_error(f"agent_decisions insert failed: {e}", exc=e)
        return

    emit_success(
        {
            "id": str(row["id"]),
            "business_id": args.business_id,
            "run_id": args.run_id,
            "graph_name": args.graph_name,
            "node_name": args.node_name,
            "decision_type": args.decision_type,
            "created_at": row["created_at"].isoformat(),
            "thresholds_schema_version": THRESHOLDS_SCHEMA_VERSION,
        }
    )


if __name__ == "__main__":
    main()
