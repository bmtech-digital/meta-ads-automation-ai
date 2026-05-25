"""
Seed minimal fixture data into local Postgres.

Inserts one `businesses` row for Aiweon using values from .env so that tools
and the golden-set can query something end-to-end. Idempotent: ON CONFLICT
(id) DO NOTHING — re-running does not overwrite manual edits to the row.

Prereq: migrations applied (bash scripts/migrate.sh).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from campaigner.lib.db import get_connection  # noqa: E402

REQUIRED = [
    (
        "BUSINESS_ID",
        "uuid of the Aiweon row — see `docker compose run --rm campaigner python -c 'import uuid; print(uuid.uuid4())'`",
    ),
    ("META_AD_ACCOUNT_ID", "Meta ad account id, must start with act_"),
    ("META_PAGE_ID", "Meta page id"),
    ("META_ACCESS_TOKEN", "Meta user or system-user access token"),
]


def _fail(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def _load_env() -> dict[str, str]:
    missing = []
    values: dict[str, str] = {}
    for key, hint in REQUIRED:
        v = os.environ.get(key, "").strip()
        if not v or v.startswith("your-") or v == "aiweon-uuid":
            missing.append(f"  - {key}: {hint}")
            continue
        values[key] = v
    if missing:
        _fail("Missing required env vars in .env:\n" + "\n".join(missing))
    return values


def _ensure_businesses_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.businesses') AS t")
        row = cur.fetchone()
        if not row or row["t"] is None:
            _fail("businesses table not found — run `bash scripts/migrate.sh` first.", code=2)


def main() -> int:
    env = _load_env()
    name = os.environ.get("BUSINESS_NAME", "Aiweon").strip() or "Aiweon"
    gcp_project = os.environ.get("GCP_PROJECT_ID", "").strip() or "bemtech-478413"

    # NOTE: local-dev TODO — `meta_access_token_encrypted` currently stores the raw
    # token. Encryption wrapper (Fernet/KMS) is deferred; see spec §21 (security).
    # The column name is kept as-is to match the production schema 1:1.
    with get_connection() as conn:
        _ensure_businesses_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO businesses (
                    id, name, meta_ad_account_id, meta_page_id,
                    meta_access_token_encrypted, gcp_project_id
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                RETURNING id
                """,
                (
                    env["BUSINESS_ID"],
                    name,
                    env["META_AD_ACCOUNT_ID"],
                    env["META_PAGE_ID"],
                    env["META_ACCESS_TOKEN"],
                    gcp_project,
                ),
            )
            inserted = cur.fetchone()
            cur.execute("SELECT id, name FROM businesses WHERE id = %s", (env["BUSINESS_ID"],))
            row = cur.fetchone()

    if inserted:
        print(f"✓ inserted businesses row: {row['id']} ({row['name']})")
    else:
        print(f"• businesses row already exists: {row['id']} ({row['name']}) — no change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
