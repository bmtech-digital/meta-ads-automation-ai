"""
Database adapter.

Local dev and Supabase are both Postgres — same engine, same SQL, same migrations.
Switching between them is a single DATABASE_URL change in .env.

Usage:
    from campaigner.lib.db import get_connection, fetch_one, fetch_all, execute

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row


class DBConfigError(RuntimeError):
    pass


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise DBConfigError(
            "DATABASE_URL not set. Local dev defaults are in docker-compose.yml "
            "(service env). For Supabase, set DATABASE_URL to the Supabase "
            "Postgres URI (Project Settings → Database → Connection string)."
        )
    return url


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """Yield a psycopg connection with dict_row factory. Commits on success, rolls back on error."""
    conn = psycopg.connect(_database_url(), row_factory=dict_row, autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchone()


def fetch_all(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def execute(sql: str, params: Sequence[Any] | None = None) -> int:
    """Execute a statement. Returns rowcount."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.rowcount


def ping() -> bool:
    """Return True if the database answers SELECT 1."""
    row = fetch_one("SELECT 1 AS ok")
    return bool(row and row.get("ok") == 1)
