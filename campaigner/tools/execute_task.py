"""
tools/execute_task.py — dispatch an approved task to Meta and persist the result.

The keystone of Flow B. For a given `approval_id` in status='approved':
  1. Load the row.
  2. Dispatch by task_type to the appropriate MetaClient method.
  3. On success: set status='executed', stash execution_result.
  4. On failure: raise — the runner handles it (calls mark_failed + logs error).

Supported task_types:
  Ad management:
    - budget_change        → MetaClient.update_budget
    - scale_up / scale_down → MetaClient.update_budget (new = old ± delta)
    - pause_campaign       → MetaClient.update_status(campaign, PAUSED)
    - resume_campaign      → MetaClient.update_status(campaign, ACTIVE)
    - pause_adset          → MetaClient.update_status(adset, PAUSED)
    - new_campaign         → MetaClient.create_complete_image_ad / video_ad
    - new_creative         → upload_image + create_image_creative + create_ad
                             (2026-05-12: wired; payload contract in _dispatch_new_creative)
    - expand_audience      → MetaClient.update_targeting
                             (2026-05-12: wired; payload.new_targeting is verbatim Meta spec)
    - boost_post           → MetaClient.create_creative_from_post (object_story_id)
                             + create_ad on existing adset.
                             (2026-05-12 Block 7: gallery→campaign loop)
    - redeploy_creative    → deploy an existing creative_gallery asset.
                             Short-circuits to create_ad(existing_creative_id)
                             when the gallery row already has meta_creative_id;
                             otherwise upload_image + create_image_creative + create_ad.
                             (2026-05-13 Block 8: gallery-first sourcing)
    - ab_test_setup        → INSERT a row into ab_tests + N rows in
                             ab_test_creatives. Pure DB — no Meta call.
                             (2026-05-13 Block 11: A/B test orchestration)
    - ab_test_decide       → UPDATE ab_tests SET status='decided', winner_*,
                             decision_snapshot. Pure DB — no Meta call.
                             (2026-05-13 Block 11)
  Organic publishing (Phase 3):
    - publish_fb_post      → page_publishing.publish_fb_*_post
    - publish_ig_post      → page_publishing.publish_ig_image_post / carousel
    - publish_ig_story     → page_publishing.publish_ig_story
    - publish_ig_reel      → page_publishing.publish_ig_reel
  Informational / web-side:
    - alert                → no Meta call. Marks executed as acknowledgement.
                             (2026-05-12: §T-1 / §T2+ / §T0r alert lanes need this.)
    - set_kpi_target       → no Meta call. Web-side handler in
                             approvals/[id]/page.tsx flips the businesses target column;
                             this dispatcher just records that the agent saw it.

The tool is **idempotent**: re-running on an already-executed row prints the
prior result and exits 0 without calling Meta again.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC
from typing import Any

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one, get_connection
from campaigner.lib.meta_client import MetaClient
from campaigner.lib.page_publishing import (
    publish_fb_photo_post,
    publish_fb_text_post,
    publish_ig_carousel_post,
    publish_ig_image_post,
    publish_ig_reel,
    publish_ig_story,
)
from campaigner.lib.page_tokens import (
    get_fb_publishing_target,
    get_ig_publishing_target,
)
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# All previously-unsupported types now have dispatchers (2026-05-12).
# Keep the set as the empty contract so re-introducing a regression is loud.
UNSUPPORTED_MVP: set[str] = set()


def _load_approval(approval_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT id, business_id, task_type, target_kind, target_id,
               payload, urgency, status, execution_result, scheduled_for,
               created_by_run_id
        FROM approvals
        WHERE id = %s
        """,
        (approval_id,),
    )


def _persist_success(approval_id: str, meta_result: dict) -> dict:
    # external_post_id and published_at are populated for publish_* task
    # types when present in meta_result. For ad-management tasks the keys
    # are absent and the columns stay NULL — same shape as before.
    external_post_id = meta_result.get("id") if isinstance(meta_result, dict) else None
    # For natively-scheduled FB posts, the actual go-live time is in the
    # future; published_at gets a NULL for those (Meta is the source of
    # truth, and we don't poll back to record the moment). For "publish now"
    # paths and IG (where we publish synchronously) we mark `now()`.
    is_scheduled_native = (
        isinstance(meta_result, dict)
        and meta_result.get("network") == "facebook"
        and meta_result.get("scheduled_for_unix") is not None
    )
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE approvals
               SET status = 'executed',
                   executed_at = now(),
                   execution_result = %s::jsonb,
                   external_post_id = %s,
                   published_at = CASE WHEN %s THEN NULL ELSE now() END
             WHERE id = %s AND status IN ('approved', 'pending')
            RETURNING id, status, executed_at
            """,
            (
                json.dumps(meta_result, default=str),
                external_post_id,
                is_scheduled_native,
                approval_id,
            ),
        )
        row = cur.fetchone()
        # Persist any forward-plan steps (תוכנית: 2-3) from this rationale to
        # plans_carryover. Migration 023 (2026-05-13 PM) — hard cross-run
        # plan memory. Failure here is non-fatal: the regex fallback in
        # load_active_plans.py + the §39 inline extractor still work, so we
        # log to stderr and continue.
        try:
            from campaigner.lib import plans as _plans

            _plans.persist_from_approval(conn, approval_id)
        except Exception as exc:  # noqa: BLE001
            print(f"plans_carryover persist failed for {approval_id}: {exc}", file=sys.stderr)
        return row


def _dispatch(client: MetaClient, approval: dict) -> dict:
    task = approval["task_type"]
    payload = approval.get("payload") or {}
    target_id = approval.get("target_id")
    target_kind = approval.get("target_kind")

    if task in UNSUPPORTED_MVP:
        raise NotImplementedError(f"task_type '{task}' is not yet wired to MetaClient in MVP")

    if task == "budget_change" or task in ("scale_up", "scale_down"):
        new_ils = payload.get("new_daily_budget_ils")
        if new_ils is None and "new_daily_budget_cents" in payload:
            new_ils = payload["new_daily_budget_cents"] / 100
        if new_ils is None:
            raise ValueError("payload must contain new_daily_budget_ils or new_daily_budget_cents")
        # MetaClient expects USD; Meta itself denominates in agorot via internal conversion.
        # Simplest path: pass ILS as "USD" to MetaClient — but the correct API is
        # to have MetaClient accept a currency. For MVP Aiweon is Hebrew-only ILS.
        usd_equivalent = float(new_ils) / float(client._m().usdils_rate)
        kind = "adset" if target_kind == "adset" else "campaign"
        return client.update_budget(
            object_type=kind, object_id=target_id, daily_budget_usd=usd_equivalent
        )

    if task == "pause_campaign":
        return client.update_status("campaign", target_id, "PAUSED")
    if task == "resume_campaign":
        return client.update_status("campaign", target_id, "ACTIVE")
    if task == "pause_adset":
        # spec uses task_type=pause_adset even when target_kind='ad' (§Gate 1 creative kills).
        kind = target_kind if target_kind in ("adset", "ad") else "adset"
        return client.update_status(kind, target_id, "PAUSED")

    if task == "new_campaign":
        return _dispatch_new_campaign(client, approval, payload)

    if task == "new_creative":
        return _dispatch_new_creative(client, approval, payload)

    if task == "expand_audience":
        return _dispatch_expand_audience(client, approval, payload)

    if task == "boost_post":
        return _dispatch_boost_post(client, approval, payload)

    if task == "redeploy_creative":
        return _dispatch_redeploy_creative(client, approval, payload)

    if task == "ab_test_setup":
        return _dispatch_ab_test_setup(approval, payload)

    if task == "ab_test_decide":
        return _dispatch_ab_test_decide(approval, payload)

    if task == "alert":
        # No Meta call. The proposal is informational — operator approved it
        # to acknowledge. Persist a structured ack so the UI can render
        # "acknowledged at <time>" instead of leaving status='pending'.
        return {
            "type": "alert",
            "alert_type": payload.get("alert_type", "unspecified"),
            "acknowledged": True,
            "message": payload.get("message"),
        }

    if task == "set_kpi_target":
        # Web-side execution. By the time we get here, the web approveAction
        # has already flipped businesses.target_<kpi>_<unit>. This dispatcher
        # is the no-op acknowledgement path for the Python flow — if a runner
        # picks up this row, just record what was set.
        return {
            "type": "set_kpi_target",
            "kpi": payload.get("kpi"),
            "value": payload.get("value"),
            "note": "web-side execution; Python dispatcher is acknowledgement-only",
        }

    if task == "create_custom_audience":
        return _dispatch_create_custom_audience(client, approval, payload)

    if task == "create_lookalike":
        return _dispatch_create_lookalike(client, approval, payload)

    if task == "create_saved_audience":
        # Meta Marketing API exposes saved_audiences as READ-ONLY (no
        # AdAccount.create_saved_audience in v25). The agent's value here is
        # specifying the targeting spec + Hebrew rationale; the operator
        # creates it in Ads Manager UI. Next sync_audiences picks it up.
        return {
            "type": "create_saved_audience",
            "status": "manual_creation_required",
            "name": payload.get("name"),
            "targeting_spec": payload.get("targeting_spec"),
            "note": (
                "Meta API does not expose saved-audience creation. Create this "
                "audience manually in Ads Manager → Audiences → Create Saved Audience "
                "using the targeting_spec above. The next sync_audiences run will "
                "register it in meta_audiences."
            ),
        }

    if task == "verify_pixel_capi":
        # Web-side execution. The web approveAction calls markTrackingVerified
        # which flips business_knowledge.tracking_verified. The actual
        # domain-verification + AEM priority-event configuration happens
        # manually in Meta Business Manager — Python can't perform it.
        pixels = payload.get("pixels") or []
        return {
            "type": "verify_pixel_capi",
            "pixel_count": len(pixels),
            "pixel_ids": [p.get("pixel_id") for p in pixels if p.get("pixel_id")],
            "capi_attested": payload.get("capi_attested", False),
            "note": "web-side execution; Python dispatcher is acknowledgement-only",
        }

    # Organic publishing — talks to Graph via page_publishing.py (HTTP-direct,
    # using a Page Access Token resolved from `meta_pages` for this business).
    # `scheduled_for` lives on the approval row; the runner only hands the row
    # to us once now() >= scheduled_for (see list_approved.py). For Facebook
    # we additionally translate it to Meta's `scheduled_publish_time` so the
    # post is *natively* scheduled — Meta then publishes even if our cron
    # misses a beat.
    if task == "publish_fb_post":
        return _dispatch_publish_fb(approval, payload)
    if task == "publish_ig_post":
        return _dispatch_publish_ig_post(approval, payload)
    if task == "publish_ig_story":
        return _dispatch_publish_ig_story(approval, payload)
    if task == "publish_ig_reel":
        return _dispatch_publish_ig_reel(approval, payload)

    raise ValueError(f"unknown task_type: {task}")


def _scheduled_for_unix(approval: dict) -> int | None:
    """Convert approvals.scheduled_for (timestamptz) to a Unix int for Meta."""
    sched = approval.get("scheduled_for")
    if sched is None:
        return None
    if hasattr(sched, "timestamp"):
        return int(sched.timestamp())
    # If the DB layer returned an ISO string, parse it.
    import datetime as _dt

    return int(_dt.datetime.fromisoformat(str(sched)).timestamp())


def _dispatch_publish_fb(approval: dict, payload: dict) -> dict:
    page_id, page_token = get_fb_publishing_target(str(approval["business_id"]))
    sched = _scheduled_for_unix(approval)
    image_url = payload.get("image_url")
    if image_url:
        return publish_fb_photo_post(
            page_id,
            page_token,
            image_url,
            caption=payload.get("caption") or payload.get("message"),
            scheduled_for_unix=sched,
        )
    message = payload.get("message")
    if not message:
        raise ValueError(
            "publish_fb_post payload must include `image_url` (for photo) or `message` (for text/link)"
        )
    return publish_fb_text_post(
        page_id,
        page_token,
        message,
        link_url=payload.get("link_url"),
        scheduled_for_unix=sched,
    )


def _dispatch_publish_ig_post(approval: dict, payload: dict) -> dict:
    ig_user_id, page_token = get_ig_publishing_target(str(approval["business_id"]))
    caption = payload.get("caption")
    image_urls = payload.get("image_urls")
    if image_urls:
        return publish_ig_carousel_post(ig_user_id, page_token, image_urls, caption=caption)
    image_url = payload.get("image_url")
    if not image_url:
        raise ValueError(
            "publish_ig_post payload must include `image_url` or `image_urls` (2..10 for carousel)"
        )
    return publish_ig_image_post(ig_user_id, page_token, image_url, caption=caption)


def _dispatch_publish_ig_story(approval: dict, payload: dict) -> dict:
    ig_user_id, page_token = get_ig_publishing_target(str(approval["business_id"]))
    return publish_ig_story(
        ig_user_id,
        page_token,
        image_url=payload.get("image_url"),
        video_url=payload.get("video_url"),
    )


def _resolve_image_path(business_id: str, payload: dict) -> str:
    """Resolve the payload's image source to a local file path that
    `MetaClient.upload_image()` can consume.

    Resolution order (first match wins):
      1. `image_path` — already a local fs path.
      2. `creative_gallery_id` — lookup `creative_gallery.storage_url`, then
         materialize locally if remote.
      3. `image_url` — remote URL; download to /tmp.

    Returns the absolute local path. Raises ValueError if none provided or
    download fails.
    """
    import tempfile
    import urllib.request
    from pathlib import Path

    local_path = payload.get("image_path")
    if local_path:
        if not Path(local_path).is_file():
            raise ValueError(f"image_path does not exist: {local_path}")
        return str(local_path)

    gallery_id = payload.get("creative_gallery_id")
    if gallery_id:
        row = fetch_one(
            """
            SELECT storage_url, mime_type
              FROM creative_gallery
             WHERE id = %s AND business_id = %s
             LIMIT 1
            """,
            (gallery_id, business_id),
        )
        if not row:
            raise ValueError(
                f"creative_gallery_id {gallery_id} not found for business {business_id}"
            )
        storage_url = row.get("storage_url")
        if not storage_url:
            raise ValueError(f"creative_gallery_id {gallery_id} has no storage_url")
        if storage_url.startswith(("/", "file:")):
            return storage_url.replace("file://", "")
        # Remote storage — fall through to URL download with the gallery URL.
        payload = {**payload, "image_url": storage_url}

    image_url = payload.get("image_url")
    if not image_url:
        raise ValueError(
            "new_creative payload requires one of: image_path, creative_gallery_id, or image_url"
        )

    # Materialize to /tmp. Use the URL's extension; default to .jpg.
    suffix = ".jpg"
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        if image_url.lower().rsplit("?", 1)[0].endswith(ext):
            suffix = ext
            break
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)  # noqa: SIM115
    tmp.close()
    try:
        tmp_path = Path(tmp.name)
        with urllib.request.urlopen(image_url, timeout=30) as r, tmp_path.open("wb") as out:
            out.write(r.read())
    except Exception as e:
        raise ValueError(f"download from image_url failed ({image_url}): {e}") from e
    return tmp.name


def _dispatch_new_creative(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Add a new ad (image creative) to an existing adset.

    Payload contract:
      Required:
        - adset_id              str | (target_kind='adset' + target_id)
        - headline              str
        - primary_text          str
        - cta                   str   Meta CTA enum (LEARN_MORE, MESSAGE_PAGE, ...)
        - link_url              str   landing page
        - one of: image_path | creative_gallery_id | image_url
      Optional:
        - description           str   (≤ 25 chars)
        - page_id               str   override; falls back to env.META_PAGE_ID
        - name                  str   ad name; falls back to "ad-<timestamp>"
        - aspect_ratio          str   recorded only — Meta picks placements

    Steps:
      1. Resolve image to local path (download if remote).
      2. Upload to Meta → image_hash.
      3. create_image_creative(image_hash, copy).
      4. create_ad(adset_id, creative_id, status=PAUSED).

    Returns:
      {id, type, adset_id, creative_id, image_hash, name, status}
    """
    from datetime import UTC, datetime

    target_kind = approval.get("target_kind")
    target_id = approval.get("target_id")
    adset_id = payload.get("adset_id") or (target_id if target_kind == "adset" else None)
    if not adset_id:
        raise ValueError(
            "new_creative requires adset_id in payload or target_kind='adset' + target_id"
        )

    for required in ("headline", "primary_text", "cta", "link_url"):
        if not payload.get(required):
            raise ValueError(f"new_creative payload missing required field: {required}")

    image_path = _resolve_image_path(str(approval["business_id"]), payload)

    image_upload = client.upload_image(image_path)
    image_hash = image_upload["image_hash"]

    name = payload.get("name") or f"ad-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"

    creative = client.create_image_creative(
        name=f"{name}-creative",
        image_hash=image_hash,
        title=payload["headline"],
        body=payload["primary_text"],
        link_url=payload["link_url"],
        call_to_action=payload["cta"],
        page_id=payload.get("page_id"),
    )

    ad = client.create_ad(
        ad_set_id=adset_id,
        creative_id=creative["id"],
        name=name,
        status="PAUSED",
    )

    return {
        "id": ad["id"],
        "type": "new_creative",
        "adset_id": adset_id,
        "creative_id": creative["id"],
        "image_hash": image_hash,
        "name": name,
        "status": "PAUSED",
        "note": "ad created PAUSED — flip to ACTIVE in Meta UI when ready",
    }


def _dispatch_boost_post(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Promote an existing organic Page post as a paid ad.

    Payload contract:
      Required:
        - external_post_id  str  — from approvals.external_post_id (the post we're boosting)
        - adset_id          str  — ad set to attach the boosted ad to
        - daily_budget_ils  number — (documented for traceability; Meta budget lives on the adset, not the ad)
      Optional:
        - page_id           str  — override; falls back to META_PAGE_ID env
        - name              str  — ad name; auto-generated if omitted
        - duration_days     int  — informational

    Steps:
      1. create_creative_from_post(post_id, page_id) — Meta's object_story_id pattern.
      2. create_ad(adset_id, creative_id, status='PAUSED').

    The ad is PAUSED by default; operator flips to ACTIVE in Meta UI when ready.
    """
    from datetime import UTC, datetime

    external_post_id = payload.get("external_post_id")
    adset_id = payload.get("adset_id")
    if not external_post_id:
        raise ValueError(
            "boost_post requires `external_post_id` in payload — the published "
            "post id from approvals.external_post_id"
        )
    if not adset_id:
        raise ValueError(
            "boost_post requires `adset_id` in payload — pick an existing ad "
            "set (boost ads don't create their own; Meta needs an adset for budget/targeting)"
        )

    name = payload.get("name") or f"boost-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"

    creative = client.create_creative_from_post(
        name=f"{name}-creative",
        post_id=str(external_post_id),
        page_id=payload.get("page_id"),
    )

    ad = client.create_ad(
        ad_set_id=str(adset_id),
        creative_id=creative["id"],
        name=name,
        status="PAUSED",
    )

    return {
        "id": ad["id"],
        "type": "boost_post",
        "creative_id": creative["id"],
        "adset_id": adset_id,
        "external_post_id": external_post_id,
        "object_story_id": creative["object_story_id"],
        "name": name,
        "status": "PAUSED",
        "note": (
            "Boost ad created PAUSED — flip to ACTIVE in Meta UI when ready. "
            "The ad inherits the post's organic reactions/comments/shares as social proof."
        ),
    }


def _dispatch_ab_test_setup(approval: dict, payload: dict) -> dict:
    """Create an A/B test row + variant rows. Block 11 (2026-05-13).

    Pure-DB operation. Meta is not touched — the creatives already live
    in the ad set; the test is metadata + a deadline + a future decision.

    Payload requirements (see propose_task.py for the full contract):
      test_name, campaign_id, adset_id, winner_metric, window_days,
      creatives: [{creative_id, variant_label, creative_gallery_id?}]
    """
    from datetime import UTC, datetime, timedelta

    test_name = payload.get("test_name")
    campaign_id = payload.get("campaign_id")
    adset_id = payload.get("adset_id")
    winner_metric = payload.get("winner_metric")
    window_days = payload.get("window_days")
    creatives = payload.get("creatives") or []

    for required, val in (
        ("test_name", test_name),
        ("campaign_id", campaign_id),
        ("adset_id", adset_id),
        ("winner_metric", winner_metric),
        ("window_days", window_days),
    ):
        if not val:
            raise ValueError(f"ab_test_setup payload missing required field: {required}")
    if winner_metric not in ("hook_rate", "ctr", "cpa", "cpl", "conversions"):
        raise ValueError(
            f"ab_test_setup.winner_metric must be one of "
            f"hook_rate/ctr/cpa/cpl/conversions (got {winner_metric!r})"
        )
    try:
        window_days_i = int(window_days)
    except (TypeError, ValueError) as e:
        raise ValueError(f"ab_test_setup.window_days must be int (got {window_days!r})") from e
    if window_days_i < 7 or window_days_i > 90:
        raise ValueError(
            f"ab_test_setup.window_days must be 7..90 (got {window_days_i}) — "
            f"guardrail §30 ab_test_min_window_7d"
        )
    if not isinstance(creatives, list) or len(creatives) < 2:
        raise ValueError(
            "ab_test_setup.creatives must be a list of ≥ 2 entries — "
            "guardrail §29 ab_test_requires_min_creatives"
        )
    if len(creatives) > 4:
        raise ValueError(
            "ab_test_setup.creatives capped at 4 — beyond that, per-variant "
            "sample sizes get too thin to decide reliably"
        )
    for i, c in enumerate(creatives):
        if not isinstance(c, dict):
            raise ValueError(f"creatives[{i}] is not an object")
        if not c.get("creative_id"):
            raise ValueError(f"creatives[{i}].creative_id missing")
        label = c.get("variant_label")
        if not label or not isinstance(label, str) or len(label) != 1 or not label.isupper():
            raise ValueError(
                f"creatives[{i}].variant_label must be a single uppercase letter (got {label!r})"
            )

    planned_end_at = datetime.now(UTC) + timedelta(days=window_days_i)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ab_tests (
              business_id, campaign_id, adset_id, test_name,
              winner_metric, planned_end_at, status, created_by_run_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'running', %s)
            RETURNING id, started_at, planned_end_at
            """,
            (
                str(approval["business_id"]),
                str(campaign_id),
                str(adset_id),
                test_name,
                winner_metric,
                planned_end_at,
                approval.get("created_by_run_id"),
            ),
        )
        row = cur.fetchone()
        test_id = row["id"]
        for c in creatives:
            cur.execute(
                """
                INSERT INTO ab_test_creatives (
                  test_id, creative_id, variant_label, creative_gallery_id
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    test_id,
                    str(c["creative_id"]),
                    c["variant_label"],
                    c.get("creative_gallery_id"),
                ),
            )

    return {
        "type": "ab_test_setup",
        "ab_test_id": str(test_id),
        "test_name": test_name,
        "adset_id": adset_id,
        "winner_metric": winner_metric,
        "started_at": row["started_at"].isoformat(),
        "planned_end_at": row["planned_end_at"].isoformat(),
        "variant_count": len(creatives),
        "note": (
            "A/B test registered in DB. Meta-side delivery is unchanged — "
            "the creatives keep running per Andromeda's allocation. Agent "
            "will emit `ab_test_decide` after planned_end_at."
        ),
    }


def _dispatch_ab_test_decide(approval: dict, payload: dict) -> dict:
    """Record the A/B test result. Block 11 (2026-05-13).

    Pure-DB operation. Updates ab_tests with winner + snapshot. Does NOT
    pause losers or scale the winner — Andromeda discipline says tests
    inform future creative choices, they don't force allocation moves.
    Operator can emit a follow-up `scale_up` / `pause_adset` if they want.
    """
    import json as _json

    ab_test_id = payload.get("ab_test_id")
    cancel = bool(payload.get("cancel_instead"))
    if not ab_test_id:
        raise ValueError("ab_test_decide payload requires `ab_test_id`")

    winner_creative_id = payload.get("winner_creative_id")
    winner_variant_label = payload.get("winner_variant_label")
    decision_reason = payload.get("decision_reason")
    decision_snapshot = payload.get("decision_snapshot")

    if not cancel:
        for required, val in (
            ("winner_creative_id", winner_creative_id),
            ("winner_variant_label", winner_variant_label),
            ("decision_reason", decision_reason),
            ("decision_snapshot", decision_snapshot),
        ):
            if not val:
                raise ValueError(
                    f"ab_test_decide payload missing required field: {required} "
                    f"(pass cancel_instead=true to skip these)"
                )
        if not isinstance(decision_snapshot, dict):
            raise ValueError("ab_test_decide.decision_snapshot must be a dict")

    business_id = str(approval["business_id"])
    new_status = "cancelled" if cancel else "decided"

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ab_tests
               SET status = %s,
                   winner_creative_id = %s,
                   decided_at = now(),
                   decision_reason = %s,
                   decision_snapshot = %s::jsonb
             WHERE id = %s AND business_id = %s
               AND status = 'running'
            RETURNING id, status, decided_at, test_name
            """,
            (
                new_status,
                None if cancel else str(winner_creative_id),
                None if cancel else decision_reason,
                None if cancel else _json.dumps(decision_snapshot),
                ab_test_id,
                business_id,
            ),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError(
                f"ab_test_decide: test {ab_test_id} not found, wrong business, "
                f"or status != 'running' (idempotent re-decide not supported — "
                f"cancel and re-setup if you need to redo)"
            )

    return {
        "type": "ab_test_decide",
        "ab_test_id": str(row["id"]),
        "test_name": row["test_name"],
        "status": row["status"],
        "decided_at": row["decided_at"].isoformat() if row["decided_at"] else None,
        "winner_variant_label": None if cancel else winner_variant_label,
        "winner_creative_id": None if cancel else str(winner_creative_id),
        "note": (
            "Test decision recorded. Andromeda discipline: no automatic "
            "pause/scale follow-up — operator decides whether to scale the "
            "winner or kill losers via separate scale_up/pause_adset proposals."
        ),
    }


def _dispatch_redeploy_creative(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Deploy an existing creative_gallery asset into an ad set.

    Block 8 (2026-05-13) — gallery-first sourcing. Use this INSTEAD of
    new_creative whenever a viable unused gallery asset exists for the
    channel (see guardrail §28 `prefer_gallery_over_generation`).

    Payload contract:
      Required:
        - creative_gallery_id   uuid   — the gallery row to deploy
        - adset_id              str    — existing ad set
      Optional:
        - name                  str    — ad name; auto-generated if omitted
        - page_id               str    — override; falls back to env.META_PAGE_ID
        - headline              str    — override gallery row's headline
        - primary_text          str    — override gallery row's primary_text
        - cta                   str    — Meta CTA enum; override gallery row's cta
        - link_url              str    — override; defaults to META_PAGE_ID profile
        - force_reupload        bool   — bypass meta_creative_id short-circuit

    Behavior:
      1. Load the gallery row. Fail if soft-deleted (deleted_at IS NOT NULL).
      2. If row has `meta_creative_id` AND payload doesn't override copy AND
         force_reupload=false → SHORT-CIRCUIT: create_ad(existing_creative_id).
         Saves an upload and a creative create.
      3. Otherwise: resolve image via _resolve_image_path (which already knows
         how to read from creative_gallery_id), upload to Meta, create a new
         creative with the (possibly overridden) copy, create the ad.
         Write back the new meta_creative_id to the gallery row so the next
         redeploy can short-circuit.

    Returns:
      {id, type, adset_id, creative_id, gallery_id, reused_creative, name, status}
    """
    from datetime import UTC, datetime

    gallery_id = payload.get("creative_gallery_id")
    adset_id = payload.get("adset_id") or (
        approval.get("target_id") if approval.get("target_kind") == "adset" else None
    )
    if not gallery_id:
        raise ValueError(
            "redeploy_creative requires `creative_gallery_id` in payload — "
            "the gallery row id to deploy"
        )
    if not adset_id:
        raise ValueError(
            "redeploy_creative requires `adset_id` in payload (or target_kind='adset' + target_id)"
        )

    business_id = str(approval["business_id"])
    row = fetch_one(
        """
        SELECT id::text AS id,
               kind,
               storage_url,
               mime_type,
               headline,
               primary_text,
               cta,
               meta_creative_id,
               deleted_at
          FROM creative_gallery
         WHERE id = %s AND business_id = %s
         LIMIT 1
        """,
        (gallery_id, business_id),
    )
    if not row:
        raise ValueError(f"creative_gallery_id {gallery_id} not found for business {business_id}")
    if row.get("deleted_at") is not None:
        raise ValueError(f"creative_gallery_id {gallery_id} is soft-deleted — pick a live asset")

    name = payload.get("name") or f"redeploy-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"
    force_reupload = bool(payload.get("force_reupload"))

    # The override is "any of headline/primary_text/cta/link_url is in payload
    # and differs from what's on the row". For simplicity: if the payload
    # supplies ANY copy field, we treat it as override (forces fresh creative).
    copy_overridden = any(
        payload.get(k) is not None for k in ("headline", "primary_text", "cta", "link_url")
    )

    existing_creative_id = row.get("meta_creative_id")
    if existing_creative_id and not force_reupload and not copy_overridden:
        # Short-circuit: reuse the existing Meta creative directly.
        ad = client.create_ad(
            ad_set_id=str(adset_id),
            creative_id=str(existing_creative_id),
            name=name,
            status="PAUSED",
        )
        return {
            "id": ad["id"],
            "type": "redeploy_creative",
            "gallery_id": gallery_id,
            "creative_id": existing_creative_id,
            "adset_id": adset_id,
            "reused_creative": True,
            "name": name,
            "status": "PAUSED",
            "note": (
                "Ad created PAUSED, reusing existing Meta creative — no upload, "
                "no creative re-create. Flip to ACTIVE in Meta UI when ready."
            ),
        }

    # Fresh-upload path. Reuse _resolve_image_path which already knows the
    # creative_gallery_id resolution rules.
    image_path = _resolve_image_path(business_id, payload)
    image_upload = client.upload_image(image_path)
    image_hash = image_upload["image_hash"]

    headline = payload.get("headline") or row.get("headline")
    primary_text = payload.get("primary_text") or row.get("primary_text")
    cta = payload.get("cta") or row.get("cta")
    link_url = payload.get("link_url")
    for required, val in (("headline", headline), ("primary_text", primary_text), ("cta", cta)):
        if not val:
            raise ValueError(
                f"redeploy_creative needs `{required}` in payload OR on the "
                f"creative_gallery row (got null for both)"
            )
    if not link_url:
        # No sensible default; ask the agent to supply one.
        raise ValueError(
            "redeploy_creative requires `link_url` in payload — "
            "the gallery row doesn't store landing-page URLs"
        )

    creative = client.create_image_creative(
        name=f"{name}-creative",
        image_hash=image_hash,
        title=headline,
        body=primary_text,
        link_url=link_url,
        call_to_action=cta,
        page_id=payload.get("page_id"),
    )

    ad = client.create_ad(
        ad_set_id=str(adset_id),
        creative_id=creative["id"],
        name=name,
        status="PAUSED",
    )

    # Write back the new meta_creative_id so the next redeploy can short-circuit.
    try:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE creative_gallery
                   SET meta_creative_id = %s,
                       uploaded_to_meta_at = COALESCE(uploaded_to_meta_at, now())
                 WHERE id = %s AND business_id = %s
                """,
                (creative["id"], gallery_id, business_id),
            )
    except Exception:
        # Non-fatal — the ad already exists in Meta. The next redeploy will
        # just re-upload instead of short-circuiting.
        pass

    return {
        "id": ad["id"],
        "type": "redeploy_creative",
        "gallery_id": gallery_id,
        "creative_id": creative["id"],
        "adset_id": adset_id,
        "image_hash": image_hash,
        "reused_creative": False,
        "name": name,
        "status": "PAUSED",
        "note": (
            "Ad created PAUSED with a fresh creative wrapping the gallery asset. "
            "Gallery row's meta_creative_id updated for future short-circuit redeploys."
        ),
    }


def _dispatch_expand_audience(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Replace the targeting of an ad set with a broader spec.

    Payload contract:
      Required (at least one of):
        - new_targeting              dict   Meta targeting spec (passed verbatim).
        - custom_audience_ids        list   Custom Audience IDs to include.
        - lookalike_audience_ids     list   Lookalike Audience IDs to include.
        - excluded_audience_ids      list   Audience IDs to exclude.
      Optional:
        - audience_strategy          str    label (e.g. "broad_with_advantage")
        - old_targeting_summary      str    one-line description of the old setup

    Phase 1 (Campaigner Mastery Plan §4.2 Step 8): the dedicated `*_audience_ids`
    lists are merged into `new_targeting.custom_audiences` and
    `new_targeting.excluded_custom_audiences` so the agent can compose
    audience-by-ID changes without hand-rolling the Meta nested array shape.
    If both forms are present, the dedicated lists win on ID dedup but values
    from `new_targeting.custom_audiences` are preserved (callers can mix).
    """
    target_kind = approval.get("target_kind")
    target_id = approval.get("target_id")
    adset_id = payload.get("adset_id") or (target_id if target_kind == "adset" else None)
    if not adset_id:
        raise ValueError(
            "expand_audience requires target_kind='adset' + target_id (or adset_id in payload)"
        )

    new_targeting = payload.get("new_targeting")
    ca_ids = payload.get("custom_audience_ids") or []
    lal_ids = payload.get("lookalike_audience_ids") or []
    excluded_ids = payload.get("excluded_audience_ids") or []

    if not isinstance(new_targeting, dict) and not (ca_ids or lal_ids or excluded_ids):
        raise ValueError(
            "expand_audience payload requires new_targeting (dict) and/or "
            "custom_audience_ids / lookalike_audience_ids / excluded_audience_ids"
        )

    # Start from new_targeting (or an empty spec) and merge audience lists in.
    merged = dict(new_targeting) if isinstance(new_targeting, dict) else {}

    if ca_ids or lal_ids:
        existing = list(merged.get("custom_audiences") or [])
        seen = {str(e.get("id")) for e in existing if isinstance(e, dict) and e.get("id")}
        for aid in list(ca_ids) + list(lal_ids):
            if aid and str(aid) not in seen:
                existing.append({"id": str(aid)})
                seen.add(str(aid))
        merged["custom_audiences"] = existing

    if excluded_ids:
        existing_excl = list(merged.get("excluded_custom_audiences") or [])
        seen_excl = {str(e.get("id")) for e in existing_excl if isinstance(e, dict) and e.get("id")}
        for aid in excluded_ids:
            if aid and str(aid) not in seen_excl:
                existing_excl.append({"id": str(aid)})
                seen_excl.add(str(aid))
        merged["excluded_custom_audiences"] = existing_excl

    result = client.update_targeting(adset_id=adset_id, new_targeting=merged)
    return {
        **result,
        "audience_strategy": payload.get("audience_strategy"),
        "old_targeting_summary": payload.get("old_targeting_summary"),
        "merged_custom_audience_count": len(merged.get("custom_audiences") or []),
        "merged_excluded_count": len(merged.get("excluded_custom_audiences") or []),
    }


def _dispatch_new_campaign(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Phase 3 — chain campaign + adset + creative + ad from the rich payload.

    Honors the propose_task `new_campaign` contract verbatim. Three responsibilities
    that don't belong inside MetaClient (which is SDK-only):

      1. Resolve `creative_source.creative_gallery_id` → either an
         `existing_creative_id` (when the gallery row already has
         meta_creative_id) or `image_path` (when only the file is on disk).
      2. Apply guardrail-level defaults the propose layer might have omitted
         (e.g., daily_budget_ils from business.monthly_budget_ils / 30 when
         absent and the campaign is OUTCOME_LEADS).
      3. After Meta returns, write the new creative back to `creative_gallery`
         if it came from a gallery row (so subsequent runs can `redeploy_creative`
         off the same asset).

    Returns the full chain result with all IDs.
    """
    from campaigner.lib.db import get_connection

    # ---- Resolve creative_gallery_id ↔ image_path ↔ existing_creative_id --
    cs = (payload.get("creative_source") or {}).copy()
    creative_gallery_id = cs.get("creative_gallery_id")
    write_back_gallery_id: str | None = None

    if creative_gallery_id and not cs.get("existing_creative_id") and not cs.get("image_path"):
        # Look up the gallery row.
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text AS id, storage_url, meta_creative_id, kind
                  FROM creative_gallery
                 WHERE id = %s AND deleted_at IS NULL
                """,
                (creative_gallery_id,),
            )
            row = cur.fetchone()
        if not row:
            raise ValueError(f"creative_gallery_id {creative_gallery_id} not found / deleted")
        if row.get("meta_creative_id"):
            # Short-circuit: reuse the existing creative.
            cs["existing_creative_id"] = row["meta_creative_id"]
        else:
            # The storage_url is a local file path like
            # `/api/gallery/file/<biz>/<key>` — resolve to disk path.
            url = row.get("storage_url") or ""
            if not url:
                raise ValueError(f"gallery row {creative_gallery_id} has no storage_url")
            # Map web-served path to container filesystem (gallery uploads
            # live under /app/web/uploads/<biz>/<key> in dev).
            cs["image_path"] = _resolve_gallery_path(url)
            write_back_gallery_id = row["id"]

    payload_resolved = {**payload, "creative_source": cs}

    # ---- Call the chain --------------------------------------------------
    result = client.create_campaign_chain(payload_resolved)

    # ---- Write the new creative back to gallery if applicable ------------
    if write_back_gallery_id and result.get("creative_id"):
        try:
            with get_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE creative_gallery
                       SET meta_creative_id = %s,
                           uploaded_to_meta_at = now()
                     WHERE id = %s AND meta_creative_id IS NULL
                    """,
                    (result["creative_id"], write_back_gallery_id),
                )
        except Exception as e:
            # Non-fatal: the campaign is up; the gallery just won't auto-link.
            result.setdefault("warnings", []).append(f"gallery write-back failed: {e!r}")

    return {
        "type": "new_campaign",
        **result,
    }


def _resolve_gallery_path(storage_url: str) -> str:
    """Map a /api/gallery/file/<biz>/<key> URL to its container disk path.

    Mirrors web/src/lib/storage.ts dev-FS layout — gallery files live at
    /app/web/uploads/<biz>/<key> in the dev image.
    """
    prefix = "/api/gallery/file/"
    if storage_url.startswith(prefix):
        return f"/app/web/uploads/{storage_url[len(prefix) :]}"
    # Already a path or some other form — pass through.
    return storage_url


_ALLOWED_CUSTOM_SUBTYPES_PHASE1 = {
    "WEBSITE",
    "ENGAGEMENT",
    "VIDEO",
    "LEAD_GENERATION",
}


def _persist_audience_row(
    business_id: str,
    kind: str,
    meta_audience: dict,
    service_tag: str | None = None,
) -> None:
    """Insert/refresh a row in meta_audiences after a successful Meta create.

    Phase 1: simplified upsert; mirrors the columns from migration 022.
    The full mirror keeps sync_audiences.py as source of truth — this just
    avoids the operator having to wait for the next daily sync to see the
    new audience.

    Block 13 (2026-05-13, migration 024): `service_tag` propagated from the
    approval payload. On conflict we keep the existing tag if non-NULL so a
    later sync_audiences run can't accidentally clear it via no-op upsert.
    """
    import json as _json
    from datetime import datetime

    from campaigner.lib.db import get_connection

    def _to_int(v):
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def _ts(v):
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                return None
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v, tz=UTC)
        return None

    def _j(v):
        if v is None or isinstance(v, (dict, list)):
            return _json.dumps(v) if v is not None else None
        return _json.dumps(v)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO meta_audiences (
                business_id, meta_audience_id, kind, subtype, name, description,
                approximate_count_lower_bound, approximate_count_upper_bound,
                retention_days, data_source, rule, lookalike_spec,
                operation_status, delivery_status, permission_for_actions,
                origin_audience_id, time_created, time_updated, meta_raw,
                service_tag, synced_at
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s, now()
            )
            ON CONFLICT (business_id, meta_audience_id) DO UPDATE SET
                synced_at = now(), archived_at = NULL,
                meta_raw = EXCLUDED.meta_raw,
                service_tag = COALESCE(meta_audiences.service_tag, EXCLUDED.service_tag)
            """,
            (
                business_id,
                str(meta_audience.get("id")),
                kind,
                meta_audience.get("subtype"),
                meta_audience.get("name") or "(unnamed)",
                meta_audience.get("description"),
                _to_int(meta_audience.get("approximate_count_lower_bound")),
                _to_int(meta_audience.get("approximate_count_upper_bound")),
                _to_int(meta_audience.get("retention_days")),
                _j(meta_audience.get("data_source")),
                _j(meta_audience.get("rule")),
                _j(meta_audience.get("lookalike_spec")),
                _j(meta_audience.get("operation_status")),
                _j(meta_audience.get("delivery_status")),
                _j(meta_audience.get("permission_for_actions")),
                meta_audience.get("origin_audience_id"),
                _ts(meta_audience.get("time_created")),
                _ts(meta_audience.get("time_updated")),
                _j(meta_audience),
                service_tag,
            ),
        )


def _dispatch_create_custom_audience(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Create a non-PII Custom Audience on Meta + mirror it locally.

    Phase 1 subtypes only: WEBSITE / ENGAGEMENT / VIDEO / LEAD_GENERATION.
    CUSTOM (customer-file PII) is deferred to Phase 2.
    """
    name = payload.get("name")
    subtype = payload.get("subtype")
    if not name or not subtype:
        raise ValueError("create_custom_audience requires payload.name + payload.subtype")
    if subtype not in _ALLOWED_CUSTOM_SUBTYPES_PHASE1:
        raise ValueError(
            f"create_custom_audience subtype '{subtype}' not allowed in Phase 1 "
            f"(allowed: {sorted(_ALLOWED_CUSTOM_SUBTYPES_PHASE1)})"
        )

    result = client.create_custom_audience(
        name=name,
        subtype=subtype,
        description=payload.get("description"),
        retention_days=int(payload.get("retention_days") or 180),
        rule=payload.get("rule"),
        pixel_id=payload.get("pixel_id"),
    )

    _persist_audience_row(
        business_id=str(approval["business_id"]),
        kind="custom",
        meta_audience=result,
        service_tag=payload.get("service_tag"),
    )

    return {
        "type": "create_custom_audience",
        "meta_audience_id": result.get("id"),
        "name": result.get("name"),
        "subtype": result.get("subtype"),
        "intended_use": payload.get("intended_use"),
    }


def _dispatch_create_lookalike(client: MetaClient, approval: dict, payload: dict) -> dict:
    """Create a Lookalike Audience from a seed + mirror locally.

    Guardrail §29 (audience_size_min) is enforced at the propose layer using
    the seed's `approximate_count_upper_bound`; we re-validate here only as
    a defense-in-depth check on time-of-execute state.
    """
    name = payload.get("name")
    origin = payload.get("origin_audience_id")
    if not name or not origin:
        raise ValueError("create_lookalike requires payload.name + payload.origin_audience_id")
    ratio = float(payload.get("ratio") or 0.01)
    if not (0.01 <= ratio <= 0.10):
        raise ValueError(f"create_lookalike ratio must be in [0.01, 0.10], got {ratio}")

    result = client.create_lookalike_audience(
        name=name,
        origin_audience_id=str(origin),
        country=str(payload.get("country") or "IL"),
        ratio=ratio,
        type_=payload.get("type"),
    )

    _persist_audience_row(
        business_id=str(approval["business_id"]),
        kind="lookalike",
        meta_audience=result,
        service_tag=payload.get("service_tag"),
    )

    return {
        "type": "create_lookalike",
        "meta_audience_id": result.get("id"),
        "name": result.get("name"),
        "origin_audience_id": origin,
        "ratio": ratio,
        "country": payload.get("country") or "IL",
        "intended_use": payload.get("intended_use"),
    }


def _dispatch_publish_ig_reel(approval: dict, payload: dict) -> dict:
    ig_user_id, page_token = get_ig_publishing_target(str(approval["business_id"]))
    video_url = payload.get("video_url")
    if not video_url:
        raise ValueError("publish_ig_reel payload requires `video_url`")
    return publish_ig_reel(
        ig_user_id,
        page_token,
        video_url,
        caption=payload.get("caption"),
        thumb_offset_ms=payload.get("thumb_offset_ms"),
        share_to_feed=bool(payload.get("share_to_feed", True)),
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Execute an approved task against Meta.")
    p.add_argument("--approval-id", required=True)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="skip the Meta call; log what would happen. Does NOT update approval status.",
    )
    args = p.parse_args()

    try:
        cfg = Config.load()
        cfg.require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        approval = with_db_retry(lambda: _load_approval(args.approval_id))
    except Exception as e:
        emit_runtime_error(f"approval load failed: {e}", exc=e)
        return

    if approval is None:
        emit_validation_error(f"approval not found: {args.approval_id}")
        return

    # Idempotency: already-executed rows return the stored result without calling Meta.
    if approval["status"] == "executed":
        emit_success(
            {
                "approval_id": str(approval["id"]),
                "status": "executed",
                "meta_result": approval.get("execution_result"),
                "already_executed": True,
            }
        )
        return

    if approval["status"] != "approved":
        emit_validation_error(
            f"approval status='{approval['status']}' — execute requires 'approved'"
        )
        return

    if args.dry_run:
        emit_success(
            {
                "approval_id": str(approval["id"]),
                "dry_run": True,
                "task_type": approval["task_type"],
                "target_kind": approval["target_kind"],
                "target_id": approval["target_id"],
                "payload": approval["payload"],
                "would_call": "MetaClient dispatch (skipped in dry-run)",
            }
        )
        return

    # Requires Meta creds from this point forward.
    try:
        cfg.require_meta()
    except ConfigError as e:
        emit_runtime_error(f"meta credentials missing: {e}", exc=e)
        return

    try:
        client = MetaClient(cfg)
        meta_result: Any = _dispatch(client, approval)
    except NotImplementedError as e:
        emit_runtime_error(str(e), exc=e)
        return
    except Exception as e:
        emit_runtime_error(f"Meta dispatch failed: {e}", exc=e)
        return

    try:
        row = with_db_retry(lambda: _persist_success(str(approval["id"]), meta_result))
    except Exception as e:
        # Meta call SUCCEEDED but DB update failed — this is the nasty failure mode.
        # Emit runtime error so runner logs and mark_failed records the discrepancy.
        emit_runtime_error(
            f"meta call succeeded but approval update failed: {e}. meta_result={meta_result}",
            exc=e,
        )
        return

    emit_success(
        {
            "approval_id": str(row["id"]),
            "status": row["status"],
            "executed_at": row["executed_at"].isoformat(),
            "meta_result": meta_result,
        }
    )


if __name__ == "__main__":
    main()
