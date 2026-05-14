"""
tools/list_active_creatives.py — fetch creatives that have been uploaded to Meta.

Used by Flow C (weekly_creative_firehose) to know what's already live so new
proposals don't duplicate angles. Reads `creative_gallery` rows with
`uploaded_to_meta_at IS NOT NULL`.

Block 5 (2026-05-12) — `--with-performance` flag fetches per-creative insights
(impressions / spend / conversions over `--perf-days`) and filters/annotates
the gallery rows. This is what §T_PE (`active_creative_count < 5`) actually
needs — without performance filtering, the count includes uploaded-but-dead
creatives and the threshold misfires.

Block 8 (2026-05-13) — `--unused-in-campaigns` and `--matches-channel` flags
turn this tool into the "gallery census" §T6.1 and §T_PE consume before
deciding whether to redeploy from the gallery or generate fresh. The
`viable_unused_count` in the output is what guardrail §28
`prefer_gallery_over_generation` reads.

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

MIN_IMPRESSIONS_DEFAULT = 100

# Block 8 (2026-05-13) — channel→aspect_ratio mapping for --matches-channel.
# Aligns with creative-guide.md §4 (Placement-Specific Copy) and §T9 cadence
# table (Feed = 1:1 / 4:5; Stories+Reels = 9:16). Reels additionally require
# kind='video'.
CHANNEL_ASPECT_MAP: dict[str, tuple[str, ...]] = {
    "feed": ("1:1", "4:5"),
    "stories": ("9:16",),
    "reels": ("9:16",),
}


def _safe_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _enrich_with_performance(
    rows: list[dict], business_id: str, perf_days: int, min_impressions: int
) -> tuple[list[dict], int]:
    """Fetch ad-level insights for the perf window, join to gallery rows
    via `meta_creative_id`, and return (enriched_rows, active_count).

    A creative is "active in performance sense" iff `impressions ≥
    min_impressions` in the window. The §T_PE threshold reads `active_count`.
    """
    from campaigner.lib.meta_client import MetaClient

    config = Config.load()
    client = MetaClient(config)
    insight_rows = client.fetch_insights(
        level="ad",
        date_preset=f"last_{perf_days}d",
        fields=[
            "ad_id",
            "campaign_id",
            "impressions",
            "spend",
            "actions",
            "clicks",
        ],
    )

    # Meta rejects `creative_id` as an insights field (#100). Look it up
    # separately via Ad(ad_id).creative; tools join by ad_id → creative_id.
    insight_ad_ids = [str(r.get("ad_id")) for r in insight_rows if r.get("ad_id")]
    ad_to_creative = client.get_ad_creative_map(insight_ad_ids)

    # Conversion-class actions — same taxonomy as check_creative_fatigue /
    # check_marginal_return. Duplicated on purpose; see those tools' notes.
    CONVERSION_TYPES = {
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
        "omni_purchase",
        "lead",
        "leadgen.other",
        "offsite_conversion.fb_pixel_lead",
        "onsite_conversion.lead_grouped",
        "onsite_conversion.messaging_conversation_started_7d",
        "complete_registration",
        "offsite_conversion.fb_pixel_complete_registration",
        "subscribe",
        "start_trial",
        "submit_application",
    }

    def _sum_conv(actions: list | None) -> float:
        if not actions:
            return 0.0
        total = 0.0
        for a in actions:
            if a.get("action_type") in CONVERSION_TYPES:
                try:
                    total += float(a.get("value", 0))
                except (TypeError, ValueError):
                    continue
        return total

    perf_by_creative: dict[str, dict] = {}
    for row in insight_rows:
        ad_id = row.get("ad_id")
        cid = ad_to_creative.get(str(ad_id)) if ad_id else None
        if not cid:
            continue
        perf_by_creative[str(cid)] = {
            "ad_id": ad_id,
            "campaign_id": row.get("campaign_id"),
            "impressions": _safe_float(row.get("impressions")),
            "clicks": _safe_float(row.get("clicks")),
            "spend": _safe_float(row.get("spend")),
            "conversions": _sum_conv(row.get("actions")),
        }

    active_count = 0
    enriched: list[dict] = []
    for r in rows:
        cid = r.get("meta_creative_id")
        perf = perf_by_creative.get(str(cid)) if cid else None
        is_active = bool(perf and perf["impressions"] >= min_impressions)
        if is_active:
            active_count += 1
        enriched.append(
            {
                **r,
                "performance_window_days": perf_days,
                "performance": perf,
                "is_active_in_window": is_active,
            }
        )
    return enriched, active_count


def main() -> None:
    p = argparse.ArgumentParser(
        description="List active (uploaded-to-Meta) creatives from creative_gallery."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--since-days", type=int, default=30, help="only creatives uploaded within N days"
    )
    p.add_argument("--limit", type=int, default=100)
    p.add_argument(
        "--with-performance",
        action="store_true",
        help="Fetch per-creative insights for the perf window, annotate each row "
        "with impressions/spend/conversions, and surface `active_with_impressions_count` "
        "for the §T_PE pool-exhaustion check (Block 5, 2026-05-12).",
    )
    p.add_argument(
        "--perf-days",
        type=int,
        default=7,
        help="Window (days) for the --with-performance fetch (default 7).",
    )
    p.add_argument(
        "--min-impressions",
        type=int,
        default=MIN_IMPRESSIONS_DEFAULT,
        help=f"Threshold for is_active_in_window (default {MIN_IMPRESSIONS_DEFAULT}).",
    )
    p.add_argument(
        "--unused-in-campaigns",
        action="store_true",
        help="Block 8 (2026-05-13): flip the query — return gallery rows that "
        "are viable but NOT currently deployed as an ad. A row is `viable_unused` "
        "iff storage_url IS NOT NULL, deleted_at IS NULL, and the meta_creative_id "
        "is either NULL or doesn't appear in any executed new_creative/redeploy_creative/"
        "boost_post/new_campaign approval. The §28 guardrail and §T6.1/§T_PE "
        "gallery-first lanes read `viable_unused_count` from this output.",
    )
    p.add_argument(
        "--matches-channel",
        choices=("feed", "stories", "reels"),
        default=None,
        help="Block 8 (2026-05-13): when combined with --unused-in-campaigns, "
        "filter assets to those that fit the channel (feed=1:1/4:5, stories=9:16, "
        "reels=9:16 video). Adds `channel` and `channel_match_count` to the output.",
    )
    args = p.parse_args()

    if args.since_days <= 0 or args.since_days > 365:
        emit_validation_error(f"--since-days must be 1..365 (got {args.since_days})")
    if args.perf_days <= 0 or args.perf_days > 30:
        emit_validation_error(f"--perf-days must be 1..30 (got {args.perf_days})")
    if args.matches_channel and not args.unused_in_campaigns:
        emit_validation_error(
            "--matches-channel requires --unused-in-campaigns (it filters the "
            "unused census, not the uploaded set)"
        )

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Block 8 (2026-05-13): two query modes.
    # 1. Default (`--unused-in-campaigns` off) — uploaded-to-Meta census, the
    #    historical Flow C behavior.
    # 2. `--unused-in-campaigns` — viable but NOT deployed as an ad. The set
    #    `§T6.1` / `§T_PE` / guardrail §28 read.
    if args.unused_in_campaigns:
        # Viable rows: live (deleted_at IS NULL) AND have storage_url AND are NOT
        # currently the creative behind any executed ad-creating approval.
        # Approval task types that produce/use a creative_id on success:
        # new_creative, redeploy_creative, boost_post, new_campaign.
        # For new_campaign the creative is created internally and the gallery
        # row may never get a meta_creative_id wired back — we still treat
        # such rows as "potentially in use" if their meta_creative_id is set
        # AND matches an executed approval's execution_result.creative_id.
        used_creative_clause = """
            (
              meta_creative_id IS NULL
              OR meta_creative_id NOT IN (
                SELECT (execution_result->>'creative_id')
                  FROM approvals
                 WHERE business_id = %s
                   AND status = 'executed'
                   AND task_type IN ('new_creative','redeploy_creative','boost_post','new_campaign')
                   AND execution_result IS NOT NULL
                   AND execution_result->>'creative_id' IS NOT NULL
              )
            )
        """
        channel_filter_sql = ""
        channel_params: tuple = ()
        if args.matches_channel:
            aspects = CHANNEL_ASPECT_MAP[args.matches_channel]
            channel_filter_sql = " AND aspect_ratio = ANY(%s)"
            channel_params = (list(aspects),)
            if args.matches_channel == "reels":
                channel_filter_sql += " AND kind = 'video'"
        sql = f"""
            SELECT id, kind, aspect_ratio, dimensions,
                   headline, primary_text, cta,
                   marketing_angle, placement,
                   generated_by, meta_creative_id,
                   uploaded_to_meta_at, performance_snapshot,
                   storage_url, service_tag,
                   created_at
              FROM creative_gallery
             WHERE business_id = %s
               AND deleted_at IS NULL
               AND storage_url IS NOT NULL
               AND {used_creative_clause}
               {channel_filter_sql}
             ORDER BY created_at DESC
             LIMIT %s
        """
        params = (args.business_id, args.business_id, *channel_params, args.limit)
        try:
            rows = with_db_retry(lambda: fetch_all(sql, params))
        except Exception as e:
            emit_runtime_error(f"creative_gallery unused-fetch failed: {e}", exc=e)
            return
    else:
        try:
            rows = with_db_retry(
                lambda: fetch_all(
                    """
                SELECT id, kind, aspect_ratio, dimensions,
                       headline, primary_text, cta,
                       marketing_angle, placement,
                       generated_by, meta_creative_id,
                       uploaded_to_meta_at, performance_snapshot,
                       created_at
                FROM creative_gallery
                WHERE business_id = %s
                  AND uploaded_to_meta_at IS NOT NULL
                  AND uploaded_to_meta_at >= now() - make_interval(days => %s)
                ORDER BY uploaded_to_meta_at DESC
                LIMIT %s
                """,
                    (args.business_id, args.since_days, args.limit),
                )
            )
        except Exception as e:
            emit_runtime_error(f"creative_gallery fetch failed: {e}", exc=e)
            return

    # Angle distribution — helps firehose avoid over-concentrating on one angle.
    angles: dict[str, int] = {}
    for r in rows:
        key = r.get("marketing_angle") or "unspecified"
        angles[key] = angles.get(key, 0) + 1

    active_with_impressions: int | None = None
    if args.with_performance:
        try:
            rows, active_with_impressions = _enrich_with_performance(
                rows,
                args.business_id,
                args.perf_days,
                args.min_impressions,
            )
        except Exception as e:
            emit_runtime_error(f"performance enrichment failed: {e}", exc=e)
            return

    payload = {
        "business_id": args.business_id,
        "count": len(rows),
        "angle_distribution": angles,
        "creatives": rows,
    }
    if active_with_impressions is not None:
        payload["active_with_impressions_count"] = active_with_impressions
        payload["perf_days"] = args.perf_days
        payload["min_impressions"] = args.min_impressions

    if args.unused_in_campaigns:
        # Block 8 (2026-05-13): expose the gallery-first census numbers.
        # `viable_unused_count` is what §T6.1, §T_PE, and guardrail §28 read.
        payload["mode"] = "unused_in_campaigns"
        payload["viable_unused_count"] = len(rows)
        if args.matches_channel:
            payload["channel"] = args.matches_channel
            payload["channel_match_count"] = len(rows)

    emit_success(payload)


if __name__ == "__main__":
    main()
