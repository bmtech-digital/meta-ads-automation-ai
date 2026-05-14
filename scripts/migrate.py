"""
Migration runner for Campaigner.

Applies every `migrations/*.sql` file in filename order, idempotent via a
`schema_migrations` tracking table. Works against local Postgres or Supabase
(any Postgres exposed via DATABASE_URL).

Usage:
    python scripts/migrate.py              # apply all pending
    python scripts/migrate.py --status     # list applied vs pending
    python scripts/migrate.py --dry-run    # show plan, don't execute

Note: only files directly in `migrations/` are applied. Subdirectories (e.g.
`_sql_pending_decision/`, `mongo/`) are ignored.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "migrations"

sys.path.insert(0, str(ROOT))
from campaigner.lib.db import get_connection  # noqa: E402

TRACKING_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _discover() -> list[Path]:
    if not MIGRATIONS_DIR.is_dir():
        return []
    return sorted(p for p in MIGRATIONS_DIR.iterdir() if p.is_file() and p.suffix == ".sql")


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _applied(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT filename, checksum FROM schema_migrations")
        return {row["filename"]: row["checksum"] for row in cur.fetchall()}


def _ensure_tracking(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(TRACKING_TABLE_SQL)


def cmd_status() -> int:
    files = _discover()
    if not files:
        print(f"No .sql migrations found in {MIGRATIONS_DIR.relative_to(ROOT)}/")
        return 0
    with get_connection() as conn:
        _ensure_tracking(conn)
        applied = _applied(conn)
    print(f"{'STATUS':<10} {'FILE':<40} CHECKSUM")
    for path in files:
        cs = _checksum(path)
        prior = applied.get(path.name)
        if prior is None:
            status = "PENDING"
        elif prior != cs:
            status = "MODIFIED"
        else:
            status = "APPLIED"
        print(f"{status:<10} {path.name:<40} {cs}")
    return 0


def cmd_apply(dry_run: bool = False) -> int:
    files = _discover()
    if not files:
        print(f"No .sql migrations found in {MIGRATIONS_DIR.relative_to(ROOT)}/ — nothing to do.")
        return 0
    with get_connection() as conn:
        _ensure_tracking(conn)
        applied = _applied(conn)
        pending = []
        for path in files:
            cs = _checksum(path)
            prior = applied.get(path.name)
            if prior is None:
                pending.append((path, cs))
            elif prior != cs:
                print(
                    f"ERROR: {path.name} was already applied with checksum {prior} "
                    f"but file on disk is {cs}. Migrations are immutable — "
                    f"create a new numbered file instead of editing.",
                    file=sys.stderr,
                )
                return 2
        if not pending:
            print("All migrations already applied.")
            return 0
        for path, cs in pending:
            if dry_run:
                print(f"[dry-run] would apply {path.name} ({cs})")
                continue
            print(f"→ applying {path.name} ({cs})")
            sql = path.read_text(encoding="utf-8")
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s)",
                    (path.name, cs),
                )
        if dry_run:
            print(f"[dry-run] {len(pending)} migration(s) would be applied.")
        else:
            print(f"✓ applied {len(pending)} migration(s).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply SQL migrations.")
    ap.add_argument("--status", action="store_true", help="show applied/pending without running")
    ap.add_argument("--dry-run", action="store_true", help="show plan without executing")
    args = ap.parse_args()
    if args.status:
        return cmd_status()
    return cmd_apply(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
