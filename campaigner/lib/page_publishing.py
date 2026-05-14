"""
Organic publishing client — Facebook Page posts + Instagram (feed, story, reel,
carousel). Separate from `meta_client.py` because:

1. Different auth shape. `meta_client.py` uses the global user access token via
   the facebook-business SDK. Organic publishing requires a **Page access
   token** (each page has its own; IG content is published via the linked
   page's token, not via a separate IG token).
2. Different API style. Organic publishing is HTTP-direct against Graph; the
   SDK's `Page.create_feed()` / `IGUser.create_media()` exist but lose more
   than they save (awkward param shapes, stale field maps).
3. Single SDK ownership rule (lib/CLAUDE.md §1). Keeping the `requests`
   coupling out of `meta_client.py` keeps that file's contract clean.

All methods take an explicit `page_access_token`. The caller looks it up from
`meta_pages.page_access_token_encrypted` (decrypted) — never reuses a stale
global token. Return shape is always JSON-safe dicts.

Reference: https://developers.facebook.com/docs/graph-api (Page Feed),
https://developers.facebook.com/docs/instagram-api/guides/content-publishing.
"""

from __future__ import annotations

import time
from typing import Any, Literal

import requests

GRAPH_API_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

# Meta's lower bound for `scheduled_publish_time`. Posts scheduled less than
# 10 minutes ahead get rejected with error code 100. We enforce client-side
# to fail fast with a meaningful message.
_FB_MIN_SCHEDULE_LEAD_SECONDS = 600

# Upper bound — Meta accepts up to 6 months out for FB scheduled posts.
_FB_MAX_SCHEDULE_LEAD_SECONDS = 60 * 60 * 24 * 180

# IG container processing poll cadence + ceiling. Reels/Video take 30-90s
# typically; image is FINISHED almost immediately.
_IG_POLL_INTERVAL_SECONDS = 3
_IG_POLL_TIMEOUT_SECONDS = 180


class PagePublishError(RuntimeError):
    """Raised when a publish call fails. Carries Meta's error envelope when present."""

    def __init__(
        self,
        message: str,
        *,
        code: int | None = None,
        type_: str | None = None,
        fbtrace_id: str | None = None,
        body: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.type = type_
        self.fbtrace_id = fbtrace_id
        self.body = body


def _post(url: str, params: dict[str, Any]) -> dict[str, Any]:
    r = requests.post(url, data=params, timeout=30)
    body = r.json()
    err = body.get("error") if isinstance(body, dict) else None
    if err or not r.ok:
        env = err or {"message": f"HTTP {r.status_code}", "code": r.status_code}
        raise PagePublishError(
            env.get("message", "graph error"),
            code=env.get("code"),
            type_=env.get("type"),
            fbtrace_id=env.get("fbtrace_id"),
            body=body,
        )
    return body


def _get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    r = requests.get(url, params=params, timeout=15)
    body = r.json()
    err = body.get("error") if isinstance(body, dict) else None
    if err or not r.ok:
        env = err or {"message": f"HTTP {r.status_code}", "code": r.status_code}
        raise PagePublishError(
            env.get("message", "graph error"),
            code=env.get("code"),
            type_=env.get("type"),
            fbtrace_id=env.get("fbtrace_id"),
            body=body,
        )
    return body


# ---- Facebook Page ---------------------------------------------------------


def publish_fb_text_post(
    page_id: str,
    page_access_token: str,
    message: str,
    *,
    link_url: str | None = None,
    scheduled_for_unix: int | None = None,
) -> dict[str, Any]:
    """
    Text (or link) post to a Page's feed. For image posts use
    `publish_fb_photo_post` — Meta separates the endpoints.

    `scheduled_for_unix` uses Meta's native scheduling. When set, the post is
    created with `published=false` and Meta publishes it at the given time.
    Constraint: between 10 minutes and 6 months from now.
    """
    _validate_fb_schedule(scheduled_for_unix)
    params: dict[str, Any] = {
        "message": message,
        "access_token": page_access_token,
    }
    if link_url:
        params["link"] = link_url
    if scheduled_for_unix:
        params["scheduled_publish_time"] = scheduled_for_unix
        params["published"] = "false"
    body = _post(f"{GRAPH_BASE}/{page_id}/feed", params)
    return {
        "network": "facebook",
        "kind": "text",
        "id": body.get("id"),
        "scheduled_for_unix": scheduled_for_unix,
    }


def publish_fb_photo_post(
    page_id: str,
    page_access_token: str,
    image_url: str,
    *,
    caption: str | None = None,
    scheduled_for_unix: int | None = None,
) -> dict[str, Any]:
    """
    Image post via the /photos edge. Single image only — for multi-image
    posts, post each separately or use IG carousel.

    Note: `caption` here becomes the visible post text (Meta exposes it as
    "message" on the resulting Post object).
    """
    _validate_fb_schedule(scheduled_for_unix)
    params: dict[str, Any] = {
        "url": image_url,
        "access_token": page_access_token,
    }
    if caption:
        params["caption"] = caption
    if scheduled_for_unix:
        params["scheduled_publish_time"] = scheduled_for_unix
        params["published"] = "false"
    body = _post(f"{GRAPH_BASE}/{page_id}/photos", params)
    return {
        "network": "facebook",
        "kind": "photo",
        "id": body.get("post_id") or body.get("id"),
        "photo_id": body.get("id"),
        "scheduled_for_unix": scheduled_for_unix,
    }


def _validate_fb_schedule(scheduled_for_unix: int | None) -> None:
    if scheduled_for_unix is None:
        return
    now = int(time.time())
    lead = scheduled_for_unix - now
    if lead < _FB_MIN_SCHEDULE_LEAD_SECONDS:
        raise ValueError(
            f"FB scheduled_publish_time must be at least 10 min from now (got {lead}s lead)"
        )
    if lead > _FB_MAX_SCHEDULE_LEAD_SECONDS:
        raise ValueError(
            f"FB scheduled_publish_time cannot be more than 6 months out (got {lead}s lead)"
        )


# ---- Instagram -------------------------------------------------------------
#
# Instagram publishing is always a two-step dance:
#   1. POST /{ig_user_id}/media   → returns a container id
#   2. POST /{ig_user_id}/media_publish?creation_id=<container_id>
#
# Video/Reel/Story containers go through async processing. We poll the
# container's `status_code` until FINISHED (or ERROR) before step 2.


IgMediaType = Literal["IMAGE", "VIDEO", "REELS", "STORIES", "CAROUSEL"]


def publish_ig_image_post(
    ig_user_id: str,
    page_access_token: str,
    image_url: str,
    *,
    caption: str | None = None,
) -> dict[str, Any]:
    """Single image to IG feed. Image hosted on a public URL Meta can fetch."""
    container = _create_ig_container(
        ig_user_id,
        page_access_token,
        {
            "image_url": image_url,
            **({"caption": caption} if caption else {}),
        },
    )
    media_id = _publish_ig_container(ig_user_id, page_access_token, container)
    return {
        "network": "instagram",
        "kind": "image",
        "id": media_id,
        "container_id": container,
    }


def publish_ig_carousel_post(
    ig_user_id: str,
    page_access_token: str,
    image_urls: list[str],
    *,
    caption: str | None = None,
) -> dict[str, Any]:
    """Multi-image carousel — Meta accepts 2..10 images per carousel."""
    if not 2 <= len(image_urls) <= 10:
        raise ValueError(f"IG carousel requires 2-10 images (got {len(image_urls)})")
    child_ids: list[str] = []
    for url in image_urls:
        cid = _create_ig_container(
            ig_user_id,
            page_access_token,
            {"image_url": url, "is_carousel_item": "true"},
        )
        child_ids.append(cid)
    parent_payload: dict[str, Any] = {
        "media_type": "CAROUSEL",
        "children": ",".join(child_ids),
    }
    if caption:
        parent_payload["caption"] = caption
    parent = _create_ig_container(ig_user_id, page_access_token, parent_payload)
    media_id = _publish_ig_container(ig_user_id, page_access_token, parent)
    return {
        "network": "instagram",
        "kind": "carousel",
        "id": media_id,
        "container_id": parent,
        "child_container_ids": child_ids,
    }


def publish_ig_reel(
    ig_user_id: str,
    page_access_token: str,
    video_url: str,
    *,
    caption: str | None = None,
    thumb_offset_ms: int | None = None,
    share_to_feed: bool = True,
) -> dict[str, Any]:
    """
    Vertical video Reel. Meta's spec: ≤90s, 9:16 vertical, MP4/MOV, <100MB.
    `share_to_feed=True` keeps the Reel discoverable on the feed too (default
    behavior in the IG app).
    """
    payload: dict[str, Any] = {
        "video_url": video_url,
        "media_type": "REELS",
        "share_to_feed": "true" if share_to_feed else "false",
    }
    if caption:
        payload["caption"] = caption
    if thumb_offset_ms is not None:
        payload["thumb_offset"] = thumb_offset_ms
    container = _create_ig_container(ig_user_id, page_access_token, payload)
    _wait_for_ig_container_ready(container, page_access_token)
    media_id = _publish_ig_container(ig_user_id, page_access_token, container)
    return {
        "network": "instagram",
        "kind": "reel",
        "id": media_id,
        "container_id": container,
    }


def publish_ig_story(
    ig_user_id: str,
    page_access_token: str,
    *,
    image_url: str | None = None,
    video_url: str | None = None,
) -> dict[str, Any]:
    """
    Story — image or video. Stories don't show captions to viewers; we
    deliberately omit the parameter so callers don't pass "copy" expecting it
    to render.
    """
    if (image_url is None) == (video_url is None):
        raise ValueError("exactly one of image_url or video_url is required")
    payload: dict[str, Any] = {"media_type": "STORIES"}
    if image_url:
        payload["image_url"] = image_url
    else:
        payload["video_url"] = video_url
    container = _create_ig_container(ig_user_id, page_access_token, payload)
    if video_url:
        _wait_for_ig_container_ready(container, page_access_token)
    media_id = _publish_ig_container(ig_user_id, page_access_token, container)
    return {
        "network": "instagram",
        "kind": "story_video" if video_url else "story_image",
        "id": media_id,
        "container_id": container,
    }


def _create_ig_container(
    ig_user_id: str,
    page_access_token: str,
    payload: dict[str, Any],
) -> str:
    body = _post(
        f"{GRAPH_BASE}/{ig_user_id}/media",
        {**payload, "access_token": page_access_token},
    )
    container_id = body.get("id")
    if not container_id:
        raise PagePublishError(
            "IG media-container create returned no id",
            body=body,
        )
    return str(container_id)


def _publish_ig_container(
    ig_user_id: str,
    page_access_token: str,
    container_id: str,
) -> str:
    body = _post(
        f"{GRAPH_BASE}/{ig_user_id}/media_publish",
        {
            "creation_id": container_id,
            "access_token": page_access_token,
        },
    )
    media_id = body.get("id")
    if not media_id:
        raise PagePublishError(
            "IG media_publish returned no id",
            body=body,
        )
    return str(media_id)


def _wait_for_ig_container_ready(
    container_id: str,
    page_access_token: str,
    timeout_seconds: int = _IG_POLL_TIMEOUT_SECONDS,
) -> None:
    """Block until container.status_code == FINISHED, or raise on ERROR/timeout."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        body = _get(
            f"{GRAPH_BASE}/{container_id}",
            {"fields": "status_code", "access_token": page_access_token},
        )
        status = body.get("status_code")
        if status == "FINISHED":
            return
        if status == "ERROR":
            raise PagePublishError(
                f"IG container {container_id} failed processing",
                body=body,
            )
        time.sleep(_IG_POLL_INTERVAL_SECONDS)
    raise PagePublishError(f"IG container {container_id} did not finish within {timeout_seconds}s")


# ---- Audience signals ------------------------------------------------------


def get_page_audience_online(
    page_id: str,
    page_access_token: str,
) -> dict[int, int]:
    """
    Fetch `/{page_id}/insights/page_fans_online_per_day` and project it onto
    the hour-of-week grid (0..167, Sun 00:00 = 0, Sat 23:00 = 167; Asia/Jerusalem
    timezone since Meta returns end_time aligned to the ad account's TZ).

    Meta returns 7 daily rows, each with an `online_per_hour` dict (24 buckets
    keyed by hour-of-day as string). We average across the 7 days to reduce
    weekday-vs-weekend noise the agent can't act on individually, then
    project hour_of_day onto hour_of_week using the date's weekday.

    Returns: {hour_of_week: score} for the 168 hours present in the window.
    Missing hours (Meta omits hours with no online fans) default to 0.

    Requires `pages_read_engagement` scope on the Page.
    """
    body = _get(
        f"{GRAPH_BASE}/{page_id}/insights/page_fans_online_per_day",
        {"period": "day", "access_token": page_access_token},
    )
    rows = body.get("data", [])
    # The data shape per row: {"name": "...", "values": [{"end_time": "...",
    # "value": {"0": 12, "1": 8, ...}}, ...]}
    grid: dict[int, int] = dict.fromkeys(range(168), 0)
    counts: dict[int, int] = dict.fromkeys(range(168), 0)
    for row in rows:
        for sample in row.get("values", []):
            end_time = sample.get("end_time")
            value = sample.get("value")
            if not end_time or not isinstance(value, dict):
                continue
            # end_time is ISO8601 like "2026-05-12T07:00:00+0000". We need the
            # weekday of the *sample's local date*. Since Meta aligns to the
            # account TZ, parse with stdlib.
            try:
                import datetime as _dt

                dt = _dt.datetime.fromisoformat(end_time.replace("Z", "+00:00"))
                weekday = (dt.weekday() + 1) % 7  # python Mon=0; we want Sun=0
            except ValueError:
                continue
            for hour_str, score in value.items():
                try:
                    hour = int(hour_str)
                except ValueError:
                    continue
                hw = weekday * 24 + hour
                if 0 <= hw < 168:
                    grid[hw] += int(score)
                    counts[hw] += 1
    # Average over the days we saw
    return {h: (grid[h] // counts[h]) if counts[h] else 0 for h in range(168)}


# ---- Read-back: organic post insights -------------------------------------
#
# Block 8 (2026-05-13). Closes the gallery→campaign feedback loop's read side.
# Block 7 shipped check_organic_performance.py with zero-filled scaffolding;
# this is the live Meta call that fills it in.
#
# Two graph endpoints, normalized to a common shape so the tool doesn't have
# to know which network it's dealing with:
#   - FB: GET /{post_id}/insights?metric=post_impressions,...
#         (+ GET /{post_id}?fields=comments.summary,shares,reactions.summary)
#   - IG: GET /{media_id}/insights?metric=impressions,reach,engagement,...
#         (+ GET /{media_id}?fields=like_count,comments_count)
#
# IG reels use a different metric set than IG image/carousel — caller passes
# `is_reel=True` and we swap.


def _parse_insights_data(insights_body: dict[str, Any]) -> dict[str, float]:
    """Meta's /insights returns {data: [{name, values: [{value}]}, ...]}.
    Flatten to {metric_name: numeric_value}.
    """
    out: dict[str, float] = {}
    for item in insights_body.get("data", []) or []:
        name = item.get("name")
        values = item.get("values") or []
        if name and values:
            v = values[0].get("value")
            if isinstance(v, (int, float)):
                out[name] = float(v)
    return out


def _fetch_fb_post_insights(post_id: str, page_access_token: str) -> dict[str, Any]:
    """FB post insights — two graph calls (insights + base reactions/comments)
    merged into a normalized dict."""
    metrics = ["post_impressions", "post_impressions_unique"]
    try:
        insights_body = _get(
            f"{GRAPH_BASE}/{post_id}/insights",
            {"metric": ",".join(metrics), "access_token": page_access_token},
        )
    except PagePublishError as e:
        return {
            "impressions": 0,
            "reach": 0,
            "reactions": 0,
            "comments": 0,
            "shares": 0,
            "saves": None,
            "video_views": None,
            "meta_error": f"insights: {e}",
        }
    insights = _parse_insights_data(insights_body)
    # Reactions, comments, shares aren't in /insights — fetch from the post
    # itself via summary edges. Wrap in try so a partial failure still returns
    # the insights numbers.
    try:
        base = _get(
            f"{GRAPH_BASE}/{post_id}",
            {
                "fields": "comments.summary(true),shares,reactions.summary(true)",
                "access_token": page_access_token,
            },
        )
    except PagePublishError:
        base = {}
    reactions_total = ((base.get("reactions") or {}).get("summary") or {}).get("total_count") or 0
    comments_total = ((base.get("comments") or {}).get("summary") or {}).get("total_count") or 0
    shares_total = (base.get("shares") or {}).get("count") or 0
    return {
        "impressions": int(insights.get("post_impressions", 0)),
        "reach": int(insights.get("post_impressions_unique", 0)),
        "reactions": int(reactions_total),
        "comments": int(comments_total),
        "shares": int(shares_total),
        "saves": None,
        "video_views": None,
    }


def _fetch_ig_post_insights(media_id: str, page_access_token: str, is_reel: bool) -> dict[str, Any]:
    """IG media insights — reels use a different metric set than image/carousel."""
    if is_reel:
        metrics = ["plays", "reach", "total_interactions", "comments", "shares", "saved"]
    else:
        metrics = ["impressions", "reach", "engagement"]
    try:
        insights_body = _get(
            f"{GRAPH_BASE}/{media_id}/insights",
            {"metric": ",".join(metrics), "access_token": page_access_token},
        )
    except PagePublishError as e:
        return {
            "impressions": 0,
            "reach": 0,
            "reactions": 0,
            "comments": 0,
            "shares": 0,
            "saves": None,
            "video_views": None,
            "meta_error": f"insights: {e}",
        }
    insights = _parse_insights_data(insights_body)
    # Likes + comments_count from base media object (IG insights doesn't
    # expose them directly).
    try:
        base = _get(
            f"{GRAPH_BASE}/{media_id}",
            {"fields": "like_count,comments_count", "access_token": page_access_token},
        )
    except PagePublishError:
        base = {}
    likes = int(base.get("like_count") or 0)
    comments_base = int(base.get("comments_count") or 0)
    if is_reel:
        plays = int(insights.get("plays", 0))
        return {
            # Reels: `plays` is the closest to FB's `impressions` semantically.
            "impressions": plays,
            "reach": int(insights.get("reach", 0)),
            "reactions": likes,
            "comments": int(insights.get("comments", comments_base)),
            "shares": int(insights.get("shares", 0)),
            "saves": int(insights.get("saved", 0)) if "saved" in insights else None,
            "video_views": plays,
        }
    return {
        "impressions": int(insights.get("impressions", 0)),
        "reach": int(insights.get("reach", 0)),
        "reactions": likes,
        "comments": comments_base,
        "shares": 0,  # IG image/carousel doesn't expose share count via API
        "saves": None,
        "video_views": None,
    }


def fetch_post_insights(
    network: Literal["facebook", "instagram"],
    post_id: str,
    page_access_token: str,
    *,
    is_reel: bool = False,
) -> dict[str, Any]:
    """Read live performance metrics for an organic post.

    Normalized output (regardless of network):
      { impressions, reach, reactions, comments, shares, saves|None,
        video_views|None, meta_error|None }

    Caller resolves the right (network, post_id, page_access_token) tuple via
    `page_tokens.get_publishing_target(...)` first.

    `is_reel` toggles the IG metric set — reels use `plays` instead of
    `impressions` and expose `saves` + `shares` via the insights endpoint.
    """
    if network == "facebook":
        return _fetch_fb_post_insights(post_id, page_access_token)
    if network == "instagram":
        return _fetch_ig_post_insights(post_id, page_access_token, is_reel)
    raise ValueError(f"unknown network: {network}")
