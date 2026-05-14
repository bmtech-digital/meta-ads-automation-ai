"""
campaigner — user-facing terminal CLI.

Subcommands:
  list      List approvals by status.
  approve   Mark an approval as approved (flows it into the execute queue).
  reject    Mark an approval as rejected with a required reason.
  inspect   Print the full decision trail for a run_id or approval_id.
  run       Manually trigger one of the cron flows (daily / execute / firehose).

Design:
  - Human-readable output by default (tables). --json flag emits machine-readable JSON.
  - Every mutating command (approve/reject) is idempotent — re-running on an already-final
    row prints the current state and exits 0, not error.
  - The CLI talks to Postgres directly via campaigner.lib.db. It never calls Meta.
    Execution of approved rows is the job of Flow B (runners/execute_approvals.sh).

Invocation:
  docker compose exec -T campaigner python -m campaigner.cli <subcmd> [args]
  # or via the `campaigner` bash wrapper at the repo root:
  ./campaigner list --pending
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import execute, fetch_all, fetch_one

REPO_ROOT = Path(__file__).resolve().parents[2]

RUNNER_FOR_FLOW = {
    "daily": "runners/daily_observe_propose.sh",
    "execute": "runners/execute_approvals.sh",
    "firehose": "runners/weekly_creative_firehose.sh",
}

FINAL_STATUSES = {"approved", "rejected", "executed", "failed", "expired"}


# =============================================================================
# list
# =============================================================================


def _cmd_list(args: argparse.Namespace) -> int:
    cfg = _load_cfg()

    conditions = ["business_id = %s"]
    params: list = [cfg.business_id]
    if args.pending:
        conditions.append("status = 'pending'")
    elif args.approved:
        conditions.append("status = 'approved'")
    elif args.status:
        conditions.append("status = %s")
        params.append(args.status)

    sql = f"""
        SELECT id, task_type, target_kind, target_id, urgency, status,
               rationale, created_at, expires_at
        FROM approvals
        WHERE {" AND ".join(conditions)}
        ORDER BY urgency DESC, created_at DESC
        LIMIT %s
    """
    params.append(args.limit)
    rows = fetch_all(sql, tuple(params))

    if args.json:
        _emit_json({"count": len(rows), "approvals": rows})
        return 0

    if not rows:
        print("(no approvals match)")
        return 0

    print(
        f"{'ID':<10} {'STATUS':<10} {'URGENCY':<8} {'TASK':<18} {'TARGET':<22} {'CREATED':<17} RATIONALE"
    )
    print("-" * 140)
    for r in rows:
        rid = str(r["id"])[:8]
        task = r["task_type"] or ""
        target = f"{r['target_kind'] or '-'}:{(r['target_id'] or '-')[:14]}"
        created = r["created_at"].strftime("%Y-%m-%d %H:%M")
        rationale = (r["rationale"] or "").replace("\n", " ")[:60]
        print(
            f"{rid:<10} {r['status']:<10} {r['urgency'] or '-':<8} {task:<18} {target:<22} {created:<17} {rationale}"
        )
    return 0


# =============================================================================
# approve
# =============================================================================


def _cmd_approve(args: argparse.Namespace) -> int:
    row = _resolve_approval(args.approval_id)
    if row is None:
        _fail_validation(f"approval not found: {args.approval_id}")

    if row["status"] in FINAL_STATUSES:
        print(f"already {row['status']} (id={row['id']}, approved_at={row.get('approved_at')})")
        return 0
    if row["status"] != "pending":
        _fail_validation(
            f"cannot approve from status '{row['status']}' — only 'pending' is approvable"
        )

    approver = args.by or "terminal"
    execute(
        """
        UPDATE approvals
           SET status = 'approved',
               approved_at = now(),
               approved_by = %s
         WHERE id = %s AND status = 'pending'
        """,
        (approver, row["id"]),
    )
    print(f"✓ approved {row['id']} by {approver}")
    return 0


# =============================================================================
# reject
# =============================================================================


def _cmd_reject(args: argparse.Namespace) -> int:
    row = _resolve_approval(args.approval_id)
    if row is None:
        _fail_validation(f"approval not found: {args.approval_id}")
    if row["status"] in FINAL_STATUSES:
        print(f"already {row['status']} (id={row['id']})")
        return 0
    if row["status"] != "pending":
        _fail_validation(f"cannot reject from status '{row['status']}'")
    if not args.reason or not args.reason.strip():
        _fail_validation("--reason is required and must be non-empty")

    approver = args.by or "terminal"
    execute(
        """
        UPDATE approvals
           SET status = 'rejected',
               approved_at = now(),
               approved_by = %s,
               rejection_reason = %s
         WHERE id = %s AND status = 'pending'
        """,
        (approver, args.reason.strip(), row["id"]),
    )
    print(f"✗ rejected {row['id']} by {approver}: {args.reason.strip()}")
    return 0


# =============================================================================
# inspect
# =============================================================================


def _cmd_inspect(args: argparse.Namespace) -> int:
    target = args.id.strip()
    approval = _resolve_approval(target)
    run_id = approval["created_by_run_id"] if approval else target

    decisions = fetch_all(
        """
        SELECT id, graph_name, node_name, decision_type, summary, rationale,
               related_approval_id, campaign_id, llm_tokens_in, llm_tokens_out,
               latency_ms, confidence, guardrail_violations, created_at
        FROM agent_decisions
        WHERE run_id = %s
        ORDER BY created_at ASC
        """,
        (run_id,),
    )

    if args.json:
        _emit_json({"approval": approval, "run_id": run_id, "decisions": decisions})
        return 0

    if approval is not None:
        print(f"Approval {approval['id']}")
        print(f"  status     {approval['status']}   urgency {approval['urgency']}")
        print(
            f"  task       {approval['task_type']}  target {approval['target_kind']}:{approval['target_id']}"
        )
        print(f"  created    {approval['created_at']}  expires {approval['expires_at']}")
        if approval.get("approved_at"):
            print(f"  approved   {approval['approved_at']} by {approval.get('approved_by')}")
        if approval.get("rejection_reason"):
            print(f"  rejection  {approval['rejection_reason']}")
        print(f"  rationale  {(approval.get('rationale') or '').strip()}")
        print()
    else:
        print(f"No approval found for id {target} — treating as run_id directly.\n")

    if not decisions:
        print(f"(no agent_decisions for run_id {run_id})")
        return 0

    print(f"Run {run_id} — {len(decisions)} decision(s):\n")
    for d in decisions:
        ts = d["created_at"].strftime("%H:%M:%S")
        head = f"[{ts}] {d['graph_name']}/{d['node_name']} — {d['decision_type']}"
        print(head)
        print(f"         {d['summary']}")
        if d.get("rationale"):
            for line in d["rationale"].splitlines():
                print(f"         | {line}")
        if d.get("guardrail_violations"):
            print(f"         guardrails: {', '.join(d['guardrail_violations'])}")
        if d.get("confidence") is not None:
            print(f"         confidence: {d['confidence']}")
        print()
    return 0


# =============================================================================
# run
# =============================================================================


def _cmd_run(args: argparse.Namespace) -> int:
    script = RUNNER_FOR_FLOW.get(args.flow)
    if script is None:
        _fail_validation(f"unknown flow '{args.flow}' — choose from {list(RUNNER_FOR_FLOW)}")
    script_path = REPO_ROOT / script
    if not script_path.exists():
        _fail_validation(f"runner missing: {script_path}")

    print(f"→ {script_path}")
    proc = subprocess.run(["bash", str(script_path)], check=False)
    return proc.returncode


# =============================================================================
# helpers
# =============================================================================


def _load_cfg() -> Config:
    try:
        cfg = Config.load()
        cfg.require_db()
        cfg.require_business()
        return cfg
    except ConfigError as e:
        _fail_validation(str(e))


def _resolve_approval(key: str) -> dict | None:
    """Accept full UUID or 8-char prefix. Returns row or None."""
    key = key.strip()
    if len(key) >= 32:
        return fetch_one("SELECT * FROM approvals WHERE id = %s", (key,))
    rows = fetch_all(
        "SELECT * FROM approvals WHERE id::text LIKE %s LIMIT 2",
        (f"{key}%",),
    )
    if len(rows) == 0:
        return None
    if len(rows) > 1:
        _fail_validation(f"prefix '{key}' matches multiple approvals — use a longer prefix")
    return rows[0]


def _emit_json(payload) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, default=_json_default)
    sys.stdout.write("\n")


def _json_default(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


def _fail_validation(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(2)


# =============================================================================
# entrypoint
# =============================================================================


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="campaigner")
    sub = p.add_subparsers(dest="cmd", required=True)

    # list
    lp = sub.add_parser("list", help="List approvals for this business")
    lp.add_argument("--pending", action="store_true", help="only pending")
    lp.add_argument("--approved", action="store_true", help="only approved")
    lp.add_argument("--status", default=None, help="filter by explicit status")
    lp.add_argument("--limit", type=int, default=50)
    lp.add_argument("--json", action="store_true")
    lp.set_defaults(func=_cmd_list)

    # approve
    ap = sub.add_parser("approve", help="Approve a pending approval")
    ap.add_argument("approval_id", help="full UUID or 8-char prefix")
    ap.add_argument("--by", default=None, help="approver identity (default: 'terminal')")
    ap.set_defaults(func=_cmd_approve)

    # reject
    rp = sub.add_parser("reject", help="Reject a pending approval with a reason")
    rp.add_argument("approval_id", help="full UUID or 8-char prefix")
    rp.add_argument("--reason", required=True, help="non-empty reason — mandatory")
    rp.add_argument("--by", default=None)
    rp.set_defaults(func=_cmd_reject)

    # inspect
    ip = sub.add_parser("inspect", help="Show decision trail for a run_id or approval_id")
    ip.add_argument("id", help="run_id, approval UUID, or approval 8-char prefix")
    ip.add_argument("--json", action="store_true")
    ip.set_defaults(func=_cmd_inspect)

    # run
    rnp = sub.add_parser("run", help="Manually trigger a cron flow")
    rnp.add_argument("flow", choices=sorted(RUNNER_FOR_FLOW.keys()))
    rnp.set_defaults(func=_cmd_run)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
