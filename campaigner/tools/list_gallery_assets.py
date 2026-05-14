"""
tools/list_gallery_assets.py — fetch user-uploaded assets from the gallery.

Used by Flow C (weekly_creative_firehose) and Flow A (when proposing
new_creative or new_campaign) to know what user-supplied images/videos are
available. Unlike list_active_creatives.py which returns assets already
live in Meta, this returns the *raw source pool* — including assets never
yet used in a creative.

Filters out soft-deleted rows (`deleted_at IS NOT NULL`). Optional filters:
  --kind {image,video}     restrict to one kind
  --service-tag <str>      restrict to a specific service tag
  --source <str>           manual_upload / imagen / gemini

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

ALLOWED_KINDS = {"image", "video", "copy"}
ALLOWED_SOURCES = {"manual_upload", "imagen", "gemini"}


def main() -> None:
    p = argparse.ArgumentParser(description="List gallery assets (non-deleted) for a business.")
    p.add_argument("--business-id", required=True)
    p.add_argument("--kind", choices=sorted(ALLOWED_KINDS), default=None)
    p.add_argument("--service-tag", default=None)
    p.add_argument("--source", choices=sorted(ALLOWED_SOURCES), default=None)
    p.add_argument("--limit", type=int, default=200)
    args = p.parse_args()

    if args.limit <= 0 or args.limit > 1000:
        emit_validation_error(f"--limit must be 1..1000 (got {args.limit})")

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    clauses = ["business_id = %s", "deleted_at IS NULL"]
    params: list = [args.business_id]
    if args.kind:
        clauses.append("kind = %s")
        params.append(args.kind)
    if args.service_tag:
        clauses.append("service_tag = %s")
        params.append(args.service_tag)
    if args.source:
        clauses.append("generated_by = %s")
        params.append(args.source)
    params.append(args.limit)

    where = " AND ".join(clauses)
    sql = f"""
        SELECT id, kind, storage_url, aspect_ratio, dimensions,
               headline, primary_text, cta,
               generated_by, marketing_angle, service_tag,
               mime_type, size_bytes, original_filename, duration_seconds,
               meta_creative_id, uploaded_to_meta_at, performance_snapshot,
               created_at
          FROM creative_gallery
         WHERE {where}
      ORDER BY created_at DESC
         LIMIT %s
    """

    try:
        rows = with_db_retry(lambda: fetch_all(sql, tuple(params)))
    except Exception as e:
        emit_runtime_error(f"creative_gallery fetch failed: {e}", exc=e)
        return

    # Breakdowns the firehose prompt uses to choose between existing vs generated.
    by_kind: dict[str, int] = {}
    by_service: dict[str, int] = {}
    unused = 0
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
        tag = r.get("service_tag") or "unspecified"
        by_service[tag] = by_service.get(tag, 0) + 1
        if not r.get("meta_creative_id"):
            unused += 1

    emit_success(
        {
            "business_id": args.business_id,
            "count": len(rows),
            "unused_count": unused,
            "by_kind": by_kind,
            "by_service_tag": by_service,
            "assets": rows,
        }
    )


if __name__ == "__main__":
    main()
