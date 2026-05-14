"""
tools/check_organic_performance.py — read insights for published organic posts.

Block 7 (2026-05-12) — scaffolding for the gallery→campaign feedback loop.
Block 8 (2026-05-13) — wired the live page-token Graph reads through
`page_publishing.fetch_post_insights`. The §T9.1 lane now sees real engagement
numbers, not zero-filled placeholders.

Phase 3 publishing wrote posts to FB/IG via `publish_*` approvals; their Meta
IDs land in `approvals.external_post_id`. Without read-back the agent couldn't
say "this organic reel went viral, boost it" or "kill organic cadence for this
brand voice, it's not landing". This tool closes that loop.

This tool:
  1. Queries `approvals` for `publish_*` rows with `external_post_id IS NOT NULL`
     and `published_at` within `--days` (default 14).
  2. For each, fetches Meta post insights via Graph (reactions / impressions /
     engagement / video views for reels).
  3. Computes per-post `engagement_rate = (reactions + comments + shares) / impressions`.
  4. Classifies against the business's rolling baseline (or default 2026 IL bands):
     - `viral` — engagement_rate ≥ 2× baseline (boost candidate)
     - `solid` — engagement_rate within ±50% of baseline
     - `underperformer` — engagement_rate < 0.5× baseline (kill organic cadence flag)
     - `insufficient_data` — impressions < 100

Output:
  {
    "business_id": "...",
    "window_days": 14,
    "posts": [
      {
        "approval_id": "...",
        "external_post_id": "...",
        "task_type": "publish_ig_reel" | "publish_fb_post" | ...,
        "published_at": "ISO",
        "impressions": int,
        "reactions": int,
        "comments": int,
        "shares": int,
        "video_views": int | null,
        "engagement_rate": float,
        "ratio_vs_baseline": float,
        "classification": "viral" | "solid" | "underperformer" | "insufficient_data"
      },
      ...
    ],
    "viral_count": int,
    "underperformer_count": int,
    "boost_candidates": [external_post_id, ...]    -- viral posts worth a boost_post proposal
  }

Used by decision-tree §T9.1 (post-promote lane) — when `boost_candidates` is
non-empty, the agent emits `boost_post` proposals at high urgency.

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

# Engagement-rate baseline (2026 IL, organic Meta). Operator's account-level
# baseline (`baselines` table) would be more accurate but isn't computed for
# organic posts yet — defer to v2.
DEFAULT_BASELINE_ENGAGEMENT_RATE = 0.025  # 2.5%
VIRAL_RATIO = 2.0
UNDERPERFORMER_RATIO = 0.5
MIN_IMPRESSIONS = 100


PUBLISH_TASK_TYPES = (
    "publish_fb_post",
    "publish_ig_post",
    "publish_ig_story",
    "publish_ig_reel",
)


def _safe_int(v) -> int:
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _network_for_task(task_type: str) -> str:
    """`publish_fb_post` → facebook. `publish_ig_*` → instagram."""
    if task_type == "publish_fb_post":
        return "facebook"
    if task_type.startswith("publish_ig_"):
        return "instagram"
    raise ValueError(f"unexpected task_type for organic post: {task_type}")


def _resolve_token_cached(business_id: str, network: str, cache: dict) -> tuple[str, str] | None:
    """Resolve (entity_id, page_token) via page_tokens; cache per (business, network)
    so we don't hit the DB once per post."""
    from campaigner.lib.page_tokens import TokenLookupError, get_publishing_target

    key = (business_id, network)
    if key in cache:
        return cache[key]
    try:
        cache[key] = get_publishing_target(business_id, network)  # type: ignore[arg-type]
    except TokenLookupError as e:
        # Cache the failure too — no point retrying mid-run.
        cache[key] = None
        cache[f"{key}__error"] = str(e)
    return cache[key]


def _fetch_post_insights(
    business_id: str, post_id: str, task_type: str, token_cache: dict
) -> dict:
    """Live Meta read for an organic post — Block 8 (2026-05-13).

    Resolves the Page Access Token via `page_tokens.get_publishing_target` (FB
    direct, IG falls back through the linked Page), then calls
    `page_publishing.fetch_post_insights` for the network. Returns normalized
    metrics with `meta_error` when the call fails — the caller treats failure
    as `insufficient_data` rather than aborting the whole run.
    """
    from campaigner.lib.page_publishing import fetch_post_insights

    try:
        network = _network_for_task(task_type)
    except ValueError as e:
        return _zero_metrics(meta_error=str(e))

    token_tuple = _resolve_token_cached(business_id, network, token_cache)
    if token_tuple is None:
        err = token_cache.get(f"{(business_id, network)}__error", "no token")
        return _zero_metrics(meta_error=f"token_lookup_failed: {err}")
    _entity_id, page_token = token_tuple

    is_reel = task_type == "publish_ig_reel"
    try:
        return fetch_post_insights(
            network=network,  # type: ignore[arg-type]
            post_id=post_id,
            page_access_token=page_token,
            is_reel=is_reel,
        )
    except Exception as e:
        return _zero_metrics(meta_error=f"{type(e).__name__}: {e}")


def _zero_metrics(*, meta_error: str | None = None) -> dict:
    return {
        "impressions": 0,
        "reach": 0,
        "reactions": 0,
        "comments": 0,
        "shares": 0,
        "saves": None,
        "video_views": None,
        "meta_error": meta_error,
    }


def _classify(engagement_rate: float, impressions: int, baseline: float) -> tuple[str, float]:
    if impressions < MIN_IMPRESSIONS:
        return ("insufficient_data", 0.0)
    ratio = engagement_rate / baseline if baseline > 0 else 0.0
    if ratio >= VIRAL_RATIO:
        return ("viral", ratio)
    if ratio < UNDERPERFORMER_RATIO:
        return ("underperformer", ratio)
    return ("solid", ratio)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Read performance of published organic posts; classify viral / solid / underperformer.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=14,
        help="Lookback window for published_at (default 14).",
    )
    p.add_argument(
        "--baseline-engagement-rate",
        type=float,
        default=DEFAULT_BASELINE_ENGAGEMENT_RATE,
        help=f"Override the engagement-rate baseline (default {DEFAULT_BASELINE_ENGAGEMENT_RATE}).",
    )
    args = p.parse_args()

    if args.days <= 0 or args.days > 90:
        emit_validation_error(f"--days must be 1..90 (got {args.days})")
        return
    if args.baseline_engagement_rate <= 0 or args.baseline_engagement_rate > 1:
        emit_validation_error(
            f"--baseline-engagement-rate must be in (0, 1] (got {args.baseline_engagement_rate})"
        )
        return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        rows = with_db_retry(
            lambda: fetch_all(
                """
            SELECT id::text       AS approval_id,
                   task_type,
                   external_post_id,
                   published_at,
                   payload
              FROM approvals
             WHERE business_id = %s
               AND task_type = ANY(%s)
               AND external_post_id IS NOT NULL
               AND published_at IS NOT NULL
               AND published_at >= now() - make_interval(days => %s)
             ORDER BY published_at DESC
             LIMIT 100
            """,
                (args.business_id, list(PUBLISH_TASK_TYPES), args.days),
            )
        )
    except Exception as e:
        emit_runtime_error(f"approvals fetch failed: {e}", exc=e)
        return

    if not rows:
        emit_success(
            {
                "business_id": args.business_id,
                "window_days": args.days,
                "baseline_engagement_rate": args.baseline_engagement_rate,
                "posts": [],
                "viral_count": 0,
                "underperformer_count": 0,
                "boost_candidates": [],
                "note": "no published_* approvals with external_post_id in window",
            }
        )
        return

    # MetaClient init is needed by some downstream paths but not by this tool's
    # page-token path. Skip the init — page_publishing uses raw requests.

    posts: list[dict] = []
    boost_candidates: list[str] = []
    viral_count = 0
    underperformer_count = 0
    token_cache: dict = {}

    for row in rows:
        post_id = row["external_post_id"]
        task_type = row["task_type"]
        insights = _fetch_post_insights(
            args.business_id, post_id, task_type, token_cache
        )

        impressions = _safe_int(insights.get("impressions"))
        reactions = _safe_int(insights.get("reactions"))
        comments = _safe_int(insights.get("comments"))
        shares = _safe_int(insights.get("shares"))
        video_views = insights.get("video_views")

        engagement = reactions + comments + shares
        engagement_rate = engagement / impressions if impressions > 0 else 0.0

        classification, ratio = _classify(
            engagement_rate, impressions, args.baseline_engagement_rate
        )

        if classification == "viral":
            viral_count += 1
            boost_candidates.append(post_id)
        elif classification == "underperformer":
            underperformer_count += 1

        posts.append(
            {
                "approval_id": row["approval_id"],
                "external_post_id": post_id,
                "task_type": task_type,
                "published_at": (
                    row["published_at"].isoformat()
                    if hasattr(row["published_at"], "isoformat")
                    else str(row["published_at"])
                ),
                "impressions": impressions,
                "reactions": reactions,
                "comments": comments,
                "shares": shares,
                "video_views": video_views,
                "engagement_rate": round(engagement_rate, 4),
                "ratio_vs_baseline": round(ratio, 2),
                "classification": classification,
                "meta_error": insights.get("meta_error"),
            }
        )

    emit_success(
        {
            "business_id": args.business_id,
            "window_days": args.days,
            "baseline_engagement_rate": args.baseline_engagement_rate,
            "posts": posts,
            "post_count": len(posts),
            "viral_count": viral_count,
            "underperformer_count": underperformer_count,
            "boost_candidates": boost_candidates,
            "note": (
                "Live Meta organic-post insights via page_publishing.fetch_post_insights "
                "(wired 2026-05-13 in Block 8). Posts with meta_error in the row are read "
                "failures — usually a deleted post, revoked token, or IG-without-linked-Page. "
                "Treat as insufficient_data."
            ),
        }
    )


if __name__ == "__main__":
    main()
