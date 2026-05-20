"""
campaigner/lib/plans.py — extract + persist + read forward-plan steps.

The agent writes a `תוכנית:` block at the end of every rationale (per
hebrew-copy-style §11 rule 6). Step 1 is "what this approval does"; steps 2-3
are forward-looking commitments — usually conditional ("if X — then propose Y").

This module is the single source of truth for those steps:

  * `extract_steps(rationale)` — parse the תוכנית block, return forward steps.
  * `persist_from_approval(conn, approval_id)` — after an approval becomes
    approved/executed, write each forward step as a `plans_carryover` row.
  * `load_active_for_target(conn, business_id, target_id)` — read pending
    steps for a campaign / account.
  * `mark_triggered(conn, plan_id, triggered_by_approval_id)` — when the
    agent proposes a follow-up that matches a pending plan.
  * `mark_superseded(conn, plan_id, reason)` — when the agent decides the
    plan is no longer relevant.

The Hebrew-text-extraction regexes mirror the ones in
`tools/load_active_plans.py` exactly so behavior stays consistent whether
the plan is read from regex-on-rationale or from this table.

Boundary rules (per lib/CLAUDE.md):
  * No Hebrew output strings — the agent generates phrasing. We return data.
  * No I/O at import time. All DB calls inside functions.
  * Single-SDK ownership — only psycopg via `lib.db`.
"""

from __future__ import annotations

import re
from typing import Any

# Regexes mirror tools/load_active_plans.py — keep them in sync.
_PLAN_HEADER_RX = re.compile(r"(?:\*\*)?תוכנית(?:\*\*)?\s*[:：]\s*")
_FOOTER_RX = re.compile(r"\n\s*אישור\s*[=—:]")
_STEP_LINE_RX = re.compile(
    r"^\s*(?:(\d+)\s*[\.\):\-]|[•●▪\-])\s*(.+?)\s*$",
    re.MULTILINE,
)
# Best-effort "if ... — ..." extractor for trigger_condition. Matches the
# common "אם <condition> — <action>" pattern Roi's style guide uses.
_TRIGGER_RX = re.compile(r"^אם\s+(.+?)\s+(?:—|–|-)\s+(.+)$")


def extract_steps(rationale: str | None) -> list[dict[str, Any]]:
    """Parse the תוכנית block, return forward-looking steps (step_order ≥ 2).

    Each step is {step_order, action_text, trigger_condition}. trigger_condition
    is None when the step doesn't follow an "if X — Y" pattern.

    Empty list if there's no תוכנית block, no steps, or only step 1.
    """
    if not rationale:
        return []
    m = _PLAN_HEADER_RX.search(rationale)
    if not m:
        return []
    after = rationale[m.end() :]
    footer_m = _FOOTER_RX.search(after)
    block = after[: footer_m.start()] if footer_m else after
    raw: list[str] = []
    for sm in _STEP_LINE_RX.finditer(block):
        text = sm.group(2).strip()
        text = re.sub(r"\*+$", "", text).strip()
        if text and len(text) > 4:
            raw.append(text)
        if len(raw) >= 5:
            break
    # Drop step 1 (already done by the parent approval).
    if len(raw) < 2:
        return []
    out: list[dict[str, Any]] = []
    for i, text in enumerate(raw[1:], start=2):
        trigger: str | None = None
        trig_m = _TRIGGER_RX.match(text)
        if trig_m:
            trigger = trig_m.group(1).strip()
        out.append(
            {
                "step_order": i,
                "action_text": text,
                "trigger_condition": trigger,
            }
        )
    return out


_VALID_OPERATORS = frozenset({">", ">=", "<", "<=", "==", "!="})
# Dotted name into config/thresholds.yaml — e.g. "gate_2.winner_ratio".
# Format-only validation; existence is not checked here (cf. CAMPAIGNER.md
# Thresholds Reference table — the agent is responsible for picking a real name).
_THRESHOLD_NAME_RX = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")


def validate_structured_plan(plan: dict) -> str | None:
    """Validate the shape of a `propose_task --plan` argument.

    Returns None when valid; a human-readable error string otherwise.

    Required shape (subset; full contract documented in propose_task.py):

        {
          "trigger": {
            "metric": str,                # required
            "operator": str,              # required; in _VALID_OPERATORS
            "threshold_name": str | None, # optional; dotted thresholds.yaml ref
            "threshold_value": number | None,  # optional; literal snapshot
            "sustained_days": int | None, # optional; >= 1
          },
          "proposed_action": {
            "task_type": str,             # required
            "payload": dict,              # required (can be empty {})
            "target_kind": str | None,
            "target_id": str | None,
          },
          "owning_flow": str,             # required
          "action_text": str,             # required (Hebrew operator readback)
          "step_order": int (default 2),  # optional; >= 2
          "expires_in_days": int (default 21),  # optional; in [1, 90]
        }
    """
    if not isinstance(plan, dict):
        return "--plan must be a JSON object"
    trigger = plan.get("trigger")
    if not isinstance(trigger, dict):
        return "--plan.trigger must be a JSON object"
    metric = trigger.get("metric")
    if not isinstance(metric, str) or not metric.strip():
        return "--plan.trigger.metric must be a non-empty string"
    operator = trigger.get("operator")
    if operator not in _VALID_OPERATORS:
        return f"--plan.trigger.operator must be one of {sorted(_VALID_OPERATORS)}"
    name = trigger.get("threshold_name")
    if name is not None:
        if not isinstance(name, str) or not _THRESHOLD_NAME_RX.match(name):
            return (
                "--plan.trigger.threshold_name must be a dotted name like "
                "'gate_2.winner_ratio' (lowercase, snake_case, single dot)"
            )
    value = trigger.get("threshold_value")
    if value is not None and not isinstance(value, int | float):
        return "--plan.trigger.threshold_value must be a number"
    if name is None and value is None:
        return (
            "--plan.trigger must include either threshold_name or threshold_value "
            "(use threshold_name for thresholds.yaml-bound rules; threshold_value "
            "for absolute literals like '30 days')"
        )
    sustained = trigger.get("sustained_days")
    if sustained is not None and (not isinstance(sustained, int) or sustained < 1):
        return "--plan.trigger.sustained_days must be a positive integer (omit for single-day signals)"

    action = plan.get("proposed_action")
    if not isinstance(action, dict):
        return "--plan.proposed_action must be a JSON object"
    task_type = action.get("task_type")
    if not isinstance(task_type, str) or not task_type.strip():
        return "--plan.proposed_action.task_type must be a non-empty string"
    payload = action.get("payload")
    if not isinstance(payload, dict):
        return "--plan.proposed_action.payload must be a JSON object (can be empty)"

    if not isinstance(plan.get("owning_flow"), str) or not plan["owning_flow"].strip():
        return "--plan.owning_flow must be a non-empty string"
    if not isinstance(plan.get("action_text"), str) or not plan["action_text"].strip():
        return "--plan.action_text must be a non-empty Hebrew step description"

    step_order = plan.get("step_order", 2)
    if not isinstance(step_order, int) or step_order < 2:
        return "--plan.step_order must be an integer >= 2 (step 1 is the approval itself)"
    expires_in_days = plan.get("expires_in_days", 21)
    if not isinstance(expires_in_days, int) or not (1 <= expires_in_days <= 90):
        return "--plan.expires_in_days must be an integer in [1, 90]"
    return None


def create_structured_row(
    conn,
    business_id: str,
    source_approval_id: str | None,
    target_kind: str | None,
    target_id: str | None,
    plan: dict,
) -> str:
    """Insert a structured plans_carryover row from a validated `--plan` arg.

    Caller MUST have run `validate_structured_plan(plan)` first and confirmed
    it returned None. The function does not re-validate — it trusts the
    propose_task layer.

    Returns the new plan row's UUID as a string.

    The Hebrew `action_text` from the agent populates `plans_carryover.action_text`
    so the operator-facing surface stays identical to legacy prose-only rows.
    The structured columns (metric / operator / threshold_name / etc.) are
    populated alongside so a future run can evaluate the trigger
    programmatically without re-parsing the Hebrew.
    """
    import json as _json

    trigger = plan["trigger"]
    action = plan["proposed_action"]
    step_order = plan.get("step_order", 2)
    expires_in_days = plan.get("expires_in_days", 21)
    # We thread a `trigger_condition` Hebrew snippet too — best-effort
    # human-readable summary if the agent supplied one. If not, derive it
    # from the structured fields so the existing operator UI surfaces
    # something legible.
    trigger_condition = trigger.get("condition_text") or (
        f"{trigger['metric']} {trigger['operator']} "
        f"{trigger.get('threshold_name') or trigger.get('threshold_value')}"
        + (
            f" (sustained {trigger['sustained_days']}d)"
            if trigger.get("sustained_days")
            else ""
        )
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO plans_carryover (
                business_id, source_approval_id,
                target_kind, target_id,
                step_order, action_text, trigger_condition,
                trigger_metric, trigger_operator,
                trigger_threshold_name, trigger_threshold_value,
                trigger_sustained_days,
                proposed_action_payload, proposed_action_task_type,
                owning_flow, expires_at
            )
            VALUES (
                %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s,
                %s::jsonb, %s,
                %s, now() + (%s || ' days')::interval
            )
            RETURNING id
            """,
            (
                business_id,
                source_approval_id,
                target_kind,
                target_id,
                step_order,
                plan["action_text"],
                trigger_condition[:500] if trigger_condition else None,
                trigger["metric"],
                trigger["operator"],
                trigger.get("threshold_name"),
                trigger.get("threshold_value"),
                trigger.get("sustained_days"),
                _json.dumps(action.get("payload") or {}),
                action["task_type"],
                plan["owning_flow"],
                str(expires_in_days),
            ),
        )
        row = cur.fetchone()
    if isinstance(row, dict):
        return str(row["id"])
    return str(row[0])


def persist_from_approval(conn, approval_id: str) -> int:
    """Read the approval, extract forward steps, insert rows into
    plans_carryover. Returns the number of rows inserted.

    Idempotent: if rows already exist for this source_approval_id, returns 0
    without re-inserting (uniqueness on source_approval_id + step_order is not
    enforced at DB level by design — we want to allow re-persisting if the
    operator edits the rationale; this caller does the dedup).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT business_id, target_kind, target_id, rationale FROM approvals WHERE id = %s",
            (approval_id,),
        )
        row = cur.fetchone()
        if not row:
            return 0
        # row may be a dict (RealDictCursor) or tuple (default) depending on
        # how the caller configured the connection.
        if isinstance(row, dict):
            business_id = row["business_id"]
            target_kind = row.get("target_kind")
            target_id = row.get("target_id")
            rationale = row.get("rationale")
        else:
            business_id, target_kind, target_id, rationale = row

        cur.execute(
            "SELECT 1 FROM plans_carryover WHERE source_approval_id = %s LIMIT 1",
            (approval_id,),
        )
        if cur.fetchone():
            return 0

        steps = extract_steps(rationale)
        if not steps:
            return 0

        inserted = 0
        for step in steps:
            cur.execute(
                """
                INSERT INTO plans_carryover (
                    business_id, source_approval_id, target_kind, target_id,
                    step_order, action_text, trigger_condition
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(business_id),
                    approval_id,
                    target_kind,
                    target_id,
                    step["step_order"],
                    step["action_text"],
                    step["trigger_condition"],
                ),
            )
            inserted += 1
    return inserted


def load_active_for_target(conn, business_id: str, target_id: str | None) -> list[dict[str, Any]]:
    """Read pending forward-plan rows for a target.

    Filters by: business_id, target_id, status='pending', expires_at > now().
    Returns the list ordered by committed_at DESC (most recent commitments
    first). Each row carries enough metadata for §39 / load_active_plans to
    surface without re-reading the source approval.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, source_approval_id, target_kind, target_id,
                   step_order, action_text, trigger_condition,
                   committed_at, expires_at
              FROM plans_carryover
             WHERE business_id = %s
               AND target_id IS NOT DISTINCT FROM %s
               AND status = 'pending'
               AND expires_at > now()
             ORDER BY committed_at DESC, step_order ASC
            """,
            (business_id, target_id),
        )
        rows = cur.fetchall()
    # Normalize: caller may have a dict or tuple cursor.
    out: list[dict[str, Any]] = []
    for r in rows:
        if isinstance(r, dict):
            out.append(
                {
                    "plan_id": str(r["id"]),
                    "source_approval_id": str(r["source_approval_id"])
                    if r.get("source_approval_id")
                    else None,
                    "target_kind": r.get("target_kind"),
                    "target_id": r.get("target_id"),
                    "step_order": r["step_order"],
                    "action_text": r["action_text"],
                    "trigger_condition": r.get("trigger_condition"),
                    "committed_on": r["committed_at"].date().isoformat()
                    if r.get("committed_at")
                    else None,
                }
            )
        else:
            (pid, src, tk, ti, so, at, tc, ca, _ea) = r
            out.append(
                {
                    "plan_id": str(pid),
                    "source_approval_id": str(src) if src else None,
                    "target_kind": tk,
                    "target_id": ti,
                    "step_order": so,
                    "action_text": at,
                    "trigger_condition": tc,
                    "committed_on": ca.date().isoformat() if ca else None,
                }
            )
    return out


def mark_triggered(conn, plan_id: str, triggered_by_approval_id: str | None = None) -> None:
    """Flip a plan row from pending → triggered."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE plans_carryover
               SET status = 'triggered',
                   triggered_at = now(),
                   triggered_by_approval_id = %s
             WHERE id = %s AND status = 'pending'
            """,
            (triggered_by_approval_id, plan_id),
        )


def mark_superseded(conn, plan_id: str, reason: str) -> None:
    """Flip a plan row from pending → superseded."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE plans_carryover
               SET status = 'superseded',
                   superseded_at = now(),
                   superseded_reason = %s
             WHERE id = %s AND status = 'pending'
            """,
            (reason[:500] if reason else None, plan_id),
        )


def mark_expired_old_rows(conn) -> int:
    """Flip pending → expired for rows past their expires_at. Returns rowcount.

    Idempotent. Intended for a nightly cron or inline cleanup. Without this
    the read path still filters via `expires_at > now()`, but explicit
    `status='expired'` makes the audit trail readable.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE plans_carryover
               SET status = 'expired'
             WHERE status = 'pending'
               AND expires_at <= now()
            """
        )
        return cur.rowcount
