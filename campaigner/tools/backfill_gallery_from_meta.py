"""
tools/backfill_gallery_from_meta.py — register existing Meta ads in `creative_gallery`.

Phase 4 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§7). The gap this closes: creatives uploaded manually via Ads Manager UI never
end up in our local `creative_gallery`. Result — `list_active_creatives` shows
count=0 even when the account has live ads, and §T_PE / §T6.1 lanes default to
"propose new_creative" instead of "redeploy existing".

For each Meta ad on the account (filtered by `--effective-status` and
optionally by `--since-days`):
  1. Look up the creative.
  2. If the creative_id is already in `creative_gallery.meta_creative_id` —
     skip.
  3. Otherwise insert a new gallery row with `generated_by='meta_backfill'`,
     populated `meta_creative_id` + `uploaded_to_meta_at`, and the creative's
     body/title/cta as `headline`/`primary_text`/`cta`. The `storage_url` is
     intentionally left NULL — we don't download the asset itself from Meta
     (binary roundtrip is expensive; the creative_id is enough for
     redeploy_creative short-circuits).

Output: summary JSON `{business_id, ads_seen, creatives_inserted,
creatives_already_known, skipped, errors}`.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

_ALLOWED_STATUS = {"ACTIVE", "PAUSED", "ARCHIVED"}

# Cap how many ads we process per run — keeps the Meta call budget bounded
# for accounts with thousands of historical ads.
_DEFAULT_MAX_ADS = 200


def _parse_meta_ts(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, tz=UTC)
    return None


def _aspect_from_creative(creative: dict) -> tuple[str | None, str | None]:
    """Best-effort guess at aspect_ratio + kind from a creative payload.

    Returns (aspect_ratio_str, kind) — both may be None. Meta doesn't
    consistently surface dimensions on every creative, so we read what we can
    and let the operator fill in the rest from /gallery.
    """
    object_type = (creative.get("object_type") or "").upper()
    kind = (
        "video"
        if object_type in {"VIDEO", "SHARE"} and creative.get("asset_feed_spec", {}).get("videos")
        else "video"
        if object_type == "VIDEO"
        else "image"
    )
    # Dimensions aren't directly exposed for most creatives via /act_X/ads.
    # Leave aspect None; gallery editing UI exposes a manual override.
    return None, kind


def _extract_copy(creative: dict) -> dict:
    """Pull headline / primary_text / cta / link_url out of Meta's creative shape.

    Meta nests these differently depending on the creative type. We check the
    common locations in order of specificity. Missing keys come back as None.
    """
    body = creative.get("body")
    title = creative.get("title")
    cta_type = creative.get("call_to_action_type")
    link_url = None

    # link_url often lives under object_story_spec.link_data.link.
    spec = creative.get("object_story_spec") or {}
    ld = spec.get("link_data") or {}
    if ld:
        body = body or ld.get("message")
        title = title or ld.get("name")
        link_url = ld.get("link")
        cta_type = cta_type or ((ld.get("call_to_action") or {}).get("type"))

    # asset_feed_spec is the newer dynamic-creative shape.
    afs = creative.get("asset_feed_spec") or {}
    if afs and not body and afs.get("bodies"):
        body = afs["bodies"][0].get("text")
    if afs and not title and afs.get("titles"):
        title = afs["titles"][0].get("text")
    if afs and not cta_type:
        ctas = afs.get("call_to_action_types") or []
        if ctas:
            cta_type = ctas[0]

    return {
        "headline": (title or "")[:200] or None,
        "primary_text": (body or "")[:2000] or None,
        "cta": cta_type,
        "link_url": link_url,
    }


def _backfill(business_id: str, effective_status: list[str], max_ads: int) -> dict:
    from campaigner.lib.meta_client import MetaClient

    try:
        client = MetaClient()
    except ConfigError as e:
        emit_runtime_error(f"Meta config invalid: {e}", e)
        return {}  # unreachable

    errors: list[str] = []
    inserted = 0
    already_known = 0
    skipped = 0
    ads_seen = 0

    # 1. List ads on the account using the SDK directly (small payload).
    try:
        from facebook_business.adobjects.adcreative import AdCreative

        client._m()  # init SDK
        params = {
            "effective_status": effective_status,
            "limit": min(max_ads, 100),
        }
        ads_iter = client._m().ad_account.get_ads(
            params=params,
            fields=[
                "id",
                "name",
                "status",
                "effective_status",
                "creative",
                "campaign_id",
                "adset_id",
                "created_time",
            ],
        )
    except Exception as e:
        emit_runtime_error(f"list ads failed: {e}", e)
        return {}  # unreachable

    creative_ids_seen: set[str] = set()
    ad_rows: list[dict] = []
    for ad in ads_iter:
        ads_seen += 1
        data = ad.export_all_data()
        ad_rows.append(data)
        cid = (data.get("creative") or {}).get("id")
        if cid:
            creative_ids_seen.add(str(cid))
        if ads_seen >= max_ads:
            break

    if not creative_ids_seen:
        return {
            "business_id": business_id,
            "ads_seen": ads_seen,
            "creatives_inserted": 0,
            "creatives_already_known": 0,
            "skipped": skipped,
            "errors": errors,
        }

    # 2. Find which creative_ids are already in the gallery.
    def _existing_ids():
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT meta_creative_id FROM creative_gallery "
                "WHERE business_id = %s "
                "AND meta_creative_id = ANY(%s) "
                "AND deleted_at IS NULL",
                (business_id, list(creative_ids_seen)),
            )
            return {str(r["meta_creative_id"]) for r in cur.fetchall()}

    try:
        known = with_db_retry(_existing_ids)
    except Exception as e:
        emit_runtime_error(f"DB lookup of known creatives failed: {e}", e)
        return {}  # unreachable

    # 3. For each NEW creative_id, fetch its content via api_get and insert.
    new_ids = creative_ids_seen - known
    already_known = len(creative_ids_seen) - len(new_ids)

    def _insert_one(cur, creative_id: str, ad_row: dict, creative_data: dict):
        copy = _extract_copy(creative_data)
        aspect, kind = _aspect_from_creative(creative_data)
        cur.execute(
            """
            INSERT INTO creative_gallery (
                business_id, kind, aspect_ratio,
                headline, primary_text, cta,
                generated_by, marketing_angle,
                meta_creative_id, uploaded_to_meta_at,
                original_filename
            )
            VALUES (
                %s, %s, %s,
                %s, %s, %s,
                'meta_backfill', NULL,
                %s, %s,
                %s
            )
            ON CONFLICT DO NOTHING
            """,
            (
                business_id,
                kind or "image",
                aspect,
                copy["headline"],
                copy["primary_text"],
                copy["cta"],
                str(creative_id),
                _parse_meta_ts(ad_row.get("created_time")),
                (creative_data.get("name") or ad_row.get("name") or "")[:200] or None,
            ),
        )

    for ad in ad_rows:
        cid = (ad.get("creative") or {}).get("id")
        if not cid or str(cid) not in new_ids:
            continue
        try:
            creative_obj = AdCreative(str(cid)).api_get(
                fields=[
                    "name",
                    "title",
                    "body",
                    "object_story_spec",
                    "asset_feed_spec",
                    "call_to_action_type",
                    "object_type",
                    "thumbnail_url",
                ]
            )
            creative_data = creative_obj.export_all_data()
        except Exception as e:
            errors.append(f"creative {cid} read failed: {e!r}")
            skipped += 1
            continue

        def _do_insert(cid=cid, ad=ad, creative_data=creative_data):
            with get_connection() as conn, conn.cursor() as cur:
                _insert_one(cur, str(cid), ad, creative_data)

        try:
            with_db_retry(_do_insert)
            inserted += 1
        except Exception as e:
            errors.append(f"insert {cid} failed: {e!r}")
            skipped += 1

    return {
        "business_id": business_id,
        "ads_seen": ads_seen,
        "creatives_inserted": inserted,
        "creatives_already_known": already_known,
        "skipped": skipped,
        "errors": errors,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Mirror existing Meta ad creatives into the local creative_gallery."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--effective-status",
        nargs="+",
        default=["ACTIVE", "PAUSED"],
        help="Meta effective_status filter for ad listing.",
    )
    p.add_argument(
        "--max-ads",
        type=int,
        default=_DEFAULT_MAX_ADS,
        help="Hard cap on ads scanned per run.",
    )
    args = p.parse_args()

    for s in args.effective_status:
        if s not in _ALLOWED_STATUS:
            emit_validation_error(f"--effective-status value '{s}' not in {_ALLOWED_STATUS}")
            return

    try:
        Config.load().require_meta()
    except ConfigError as e:
        emit_validation_error(f"Meta config missing: {e}")
        return

    try:
        summary = _backfill(args.business_id, args.effective_status, args.max_ads)
    except Exception as e:
        emit_runtime_error(f"backfill failed: {e}", e)
        return

    emit_success(summary)


if __name__ == "__main__":
    main()
