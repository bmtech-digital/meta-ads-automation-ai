"""One-time setup: create Supabase Storage bucket `creative-gallery`.

Idempotent — safe to re-run. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
from env. Bucket is PUBLIC (internal B2B tool; spec §1.9 did not mandate RLS
on the object layer — the DB row is RLS-enforced).

Usage:
    docker compose run --rm campaigner python scripts/setup_gallery_bucket.py
"""
from __future__ import annotations

import os
import sys
from urllib.parse import urljoin

import requests

BUCKET = os.environ.get("STORAGE_BUCKET", "creative-gallery")


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        return 2

    base = url.rstrip("/") + "/"
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    r = requests.get(urljoin(base, f"storage/v1/bucket/{BUCKET}"), headers=headers, timeout=15)
    if r.status_code == 200:
        print(f"bucket {BUCKET!r} already exists")
        return 0

    r = requests.post(
        urljoin(base, "storage/v1/bucket"),
        headers={**headers, "Content-Type": "application/json"},
        json={"id": BUCKET, "name": BUCKET, "public": True},
        timeout=15,
    )
    if r.status_code not in (200, 201):
        print(f"create failed [{r.status_code}]: {r.text}", file=sys.stderr)
        return 1
    print(f"bucket {BUCKET!r} created (public)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
