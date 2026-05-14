"""
Baseline computation + CRUD for the `baselines` table.

`baselines` is append-only: every compute produces a new row with its own
`computed_at`, and readers pull the most-recent row per (scope, scope_id,
metric, window_days). This keeps a full history for free and lets the
observe-propose flow reason about drift over time.

This module exposes primitives. The full observe→compute→persist pipeline
lives in `campaigner/tools/load_baselines.py` (task 4.3).
"""

from __future__ import annotations

from collections.abc import Sequence
from statistics import mean
from typing import Literal

from .db import get_connection

Scope = Literal["account", "campaign", "adset"]


# ---------------------------------------------------------------- computation


def compute_mean(values: Sequence[float]) -> float:
    """
    Arithmetic mean across a series (e.g. last N days of a metric).

    Returns 0.0 for empty input — callers must decide themselves whether a
    baseline of 0.0 is meaningful (it usually isn't: check data sufficiency
    upstream rather than blindly persisting).
    """
    if not values:
        return 0.0
    return float(mean(values))


# ----------------------------------------------------------------------- CRUD


def upsert_baseline(
    business_id: str,
    scope: Scope,
    scope_id: str | None,
    metric: str,
    value: float,
    window_days: int,
) -> dict:
    """
    Insert a new baseline snapshot. Name is `upsert_*` for API familiarity,
    but semantics are append-only — each call produces a new row.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO baselines (business_id, scope, scope_id, metric, value, window_days)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, computed_at
            """,
            (business_id, scope, scope_id, metric, value, window_days),
        )
        row = cur.fetchone()
    return {
        "id": str(row["id"]),
        "business_id": business_id,
        "scope": scope,
        "scope_id": scope_id,
        "metric": metric,
        "value": float(value),
        "window_days": window_days,
        "computed_at": row["computed_at"].isoformat(),
    }


def load_baseline(
    business_id: str,
    scope: Scope,
    scope_id: str | None,
    metric: str,
    window_days: int,
) -> dict | None:
    """Return the most recent baseline row for a specific (scope, scope_id, metric, window_days), or None."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, business_id, scope, scope_id, metric, value, window_days, computed_at
            FROM baselines
            WHERE business_id = %s
              AND scope = %s
              AND metric = %s
              AND window_days = %s
              AND scope_id IS NOT DISTINCT FROM %s
            ORDER BY computed_at DESC
            LIMIT 1
            """,
            (business_id, scope, metric, window_days, scope_id),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return _serialize(row)


def load_baselines(
    business_id: str,
    scope: Scope | None = None,
    metric: str | None = None,
    window_days: int | None = None,
) -> list[dict]:
    """
    List latest baselines with optional filters. Returns at most one row per
    (scope, scope_id, metric, window_days) tuple — the most recent.
    """
    conditions = ["business_id = %s"]
    params: list = [business_id]
    if scope is not None:
        conditions.append("scope = %s")
        params.append(scope)
    if metric is not None:
        conditions.append("metric = %s")
        params.append(metric)
    if window_days is not None:
        conditions.append("window_days = %s")
        params.append(window_days)

    sql = f"""
        SELECT DISTINCT ON (scope, scope_id, metric, window_days)
            id, business_id, scope, scope_id, metric, value, window_days, computed_at
        FROM baselines
        WHERE {" AND ".join(conditions)}
        ORDER BY scope, scope_id, metric, window_days, computed_at DESC
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [_serialize(r) for r in rows]


# ------------------------------------------------------------------ internal


def _serialize(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "business_id": str(row["business_id"]),
        "scope": row["scope"],
        "scope_id": row["scope_id"],
        "metric": row["metric"],
        "value": float(row["value"]),
        "window_days": row["window_days"],
        "computed_at": row["computed_at"].isoformat(),
    }
