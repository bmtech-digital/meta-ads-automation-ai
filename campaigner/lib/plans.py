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
    after = rationale[m.end():]
    footer_m = _FOOTER_RX.search(after)
    block = after[:footer_m.start()] if footer_m else after
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
        out.append({
            "step_order": i,
            "action_text": text,
            "trigger_condition": trigger,
        })
    return out


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
            "SELECT business_id, target_kind, target_id, rationale "
            "FROM approvals WHERE id = %s",
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
            out.append({
                "plan_id": str(r["id"]),
                "source_approval_id": str(r["source_approval_id"]) if r.get("source_approval_id") else None,
                "target_kind": r.get("target_kind"),
                "target_id": r.get("target_id"),
                "step_order": r["step_order"],
                "action_text": r["action_text"],
                "trigger_condition": r.get("trigger_condition"),
                "committed_on": r["committed_at"].date().isoformat() if r.get("committed_at") else None,
            })
        else:
            (pid, src, tk, ti, so, at, tc, ca, _ea) = r
            out.append({
                "plan_id": str(pid),
                "source_approval_id": str(src) if src else None,
                "target_kind": tk,
                "target_id": ti,
                "step_order": so,
                "action_text": at,
                "trigger_condition": tc,
                "committed_on": ca.date().isoformat() if ca else None,
            })
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
