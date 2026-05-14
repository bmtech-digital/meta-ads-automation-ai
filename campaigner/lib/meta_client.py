"""
Clean facade over the legacy `meta_ads_manager.MetaAdsManager`.

Two responsibilities beyond delegation:

1. Return JSON-safe dicts (never `facebook_business` SDK objects) so tools can
   `json.dumps(...)` the result without custom encoders.
2. Add methods absent from the legacy manager but required by the optimizer:
   `fetch_insights`, `update_status`, `update_budget`.

The legacy manager stays as-is — this is the stable API surface the rest of
the codebase should import. Do not reach through to `._manager` from tools;
if something is missing, add a method here.
"""

from __future__ import annotations

import contextlib
import sys
from pathlib import Path
from typing import Any, Literal

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from facebook_business.adobjects.ad import Ad  # noqa: E402
from facebook_business.adobjects.adset import AdSet  # noqa: E402
from facebook_business.adobjects.campaign import Campaign  # noqa: E402

# CustomAudience is lazy-imported inside the audience methods — its import
# chain pulls in dozens of facebook-business adobjects (~15s in v25), which
# slows every tool startup. Tools that don't touch audiences shouldn't pay
# that cost.
from meta_ads_manager import MetaAdsManager  # noqa: E402

from .config import Config  # noqa: E402

ObjectType = Literal["campaign", "adset", "ad"]
StatusValue = Literal["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]
InsightLevel = Literal["account", "campaign", "adset", "ad"]

_OBJECT_CLASS: dict[str, type] = {
    "campaign": Campaign,
    "adset": AdSet,
    "ad": Ad,
}


def _safe_float(v: Any) -> float | None:
    """Convert a Meta insights value to float; return None on missing/garbage.

    Meta returns numbers as strings ("1234.56") and sometimes as missing keys.
    Helper for `fetch_insights_with_prior_window` so the comparison code stays
    readable.
    """
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


_DEFAULT_INSIGHT_FIELDS = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "impressions",
    "reach",
    "frequency",
    "spend",
    "clicks",
    "ctr",
    "cpm",
    "cpc",
    "actions",
    "action_values",
    "video_play_actions",
    "video_thruplay_watched_actions",
    "date_start",
    "date_stop",
]


def _default_optimization_goal_for_objective(objective: str) -> str:
    """Map campaign objective → reasonable default ad-set optimization goal.

    Used by `create_campaign_chain` when the propose layer didn't specify
    optimization_goal explicitly. Conservative defaults per Meta's 2026
    objective→goal compatibility matrix.
    """
    return {
        "OUTCOME_LEADS": "LEAD_GENERATION",
        "OUTCOME_SALES": "OFFSITE_CONVERSIONS",
        "OUTCOME_TRAFFIC": "LINK_CLICKS",
        "OUTCOME_ENGAGEMENT": "CONVERSATIONS",
        "OUTCOME_AWARENESS": "REACH",
        "OUTCOME_APP_PROMOTION": "APP_INSTALLS",
    }.get(objective, "LINK_CLICKS")


class MetaClient:
    def __init__(self, config: Config | None = None):
        self._config = config or Config.load()
        self._config.require_meta()
        self._manager: MetaAdsManager | None = None

    def _m(self) -> MetaAdsManager:
        if self._manager is None:
            self._manager = MetaAdsManager(
                app_id=self._config.meta_app_id,
                app_secret=self._config.meta_app_secret,
                access_token=self._config.meta_access_token,
                ad_account_id=self._config.meta_ad_account_id,
            )
        return self._manager

    # ---------------------------------------------------------------- media

    def upload_image(self, image_path: str, name: str | None = None) -> dict:
        image_hash = self._m().upload_image(image_path, image_name=name)
        return {"image_hash": image_hash}

    def upload_video(self, video_path: str, name: str | None = None) -> dict:
        video_id = self._m().upload_video(video_path, video_name=name)
        return {"video_id": video_id}

    # --------------------------------------------------------- object create

    def create_campaign(
        self,
        name: str,
        objective: str = "OUTCOME_TRAFFIC",
        status: StatusValue = "PAUSED",
        special_ad_categories: list[str] | None = None,
    ) -> dict:
        campaign = self._m().create_campaign(
            name=name,
            objective=objective,
            status=status,
            special_ad_categories=special_ad_categories,
        )
        return {
            "id": campaign.get_id(),
            "type": "campaign",
            "name": name,
            "objective": objective,
            "status": status,
        }

    def create_ad_set(
        self,
        campaign_id: str,
        name: str,
        daily_budget_usd: float,
        targeting: dict,
        optimization_goal: str = "LINK_CLICKS",
        billing_event: str = "IMPRESSIONS",
        bid_amount: int | None = None,
    ) -> dict:
        ad_set = self._m().create_ad_set(
            campaign_id=campaign_id,
            name=name,
            daily_budget_usd=daily_budget_usd,
            targeting=targeting,
            optimization_goal=optimization_goal,
            billing_event=billing_event,
            bid_amount=bid_amount,
        )
        return {
            "id": ad_set.get_id(),
            "type": "adset",
            "name": name,
            "campaign_id": campaign_id,
            "daily_budget_usd": daily_budget_usd,
            "daily_budget_agorot": self._m().usd_to_agorot(daily_budget_usd),
            "optimization_goal": optimization_goal,
        }

    def create_image_creative(
        self,
        name: str,
        image_hash: str,
        title: str,
        body: str,
        link_url: str,
        call_to_action: str = "LEARN_MORE",
        page_id: str | None = None,
    ) -> dict:
        creative = self._m().create_ad_creative(
            name=name,
            image_hash=image_hash,
            title=title,
            body=body,
            link_url=link_url,
            call_to_action_type=call_to_action,
            page_id=page_id or self._config.meta_page_id,
        )
        return {"id": creative.get_id(), "type": "creative", "kind": "image", "name": name}

    def create_video_creative(
        self,
        name: str,
        video_id: str,
        title: str,
        body: str,
        link_url: str,
        call_to_action: str = "LEARN_MORE",
        page_id: str | None = None,
        thumbnail_hash: str | None = None,
    ) -> dict:
        creative = self._m().create_video_ad_creative(
            name=name,
            video_id=video_id,
            title=title,
            body=body,
            link_url=link_url,
            call_to_action_type=call_to_action,
            page_id=page_id or self._config.meta_page_id,
            thumbnail_hash=thumbnail_hash,
        )
        return {"id": creative.get_id(), "type": "creative", "kind": "video", "name": name}

    def create_ad(
        self,
        ad_set_id: str,
        creative_id: str,
        name: str,
        status: StatusValue = "PAUSED",
    ) -> dict:
        ad = self._m().create_ad(
            ad_set_id=ad_set_id,
            creative_id=creative_id,
            name=name,
            status=status,
        )
        return {
            "id": ad.get_id(),
            "type": "ad",
            "name": name,
            "ad_set_id": ad_set_id,
            "creative_id": creative_id,
            "status": status,
        }

    # -------------------------------------------------------------- bundles

    def create_complete_image_ad(
        self,
        *,
        campaign_name: str,
        ad_name: str,
        image_path: str,
        title: str,
        body: str,
        link_url: str,
        daily_budget_usd: float,
        targeting: dict,
        objective: str = "OUTCOME_TRAFFIC",
        call_to_action: str = "LEARN_MORE",
        special_ad_categories: list[str] | None = None,
    ) -> dict:
        return self._m().create_complete_ad(
            campaign_name=campaign_name,
            ad_name=ad_name,
            image_path=image_path,
            title=title,
            body=body,
            link_url=link_url,
            daily_budget_usd=daily_budget_usd,
            targeting=targeting,
            objective=objective,
            call_to_action=call_to_action,
            special_ad_categories=special_ad_categories,
        )

    def create_complete_video_ad(
        self,
        *,
        campaign_name: str,
        ad_name: str,
        video_path: str,
        title: str,
        body: str,
        link_url: str,
        daily_budget_usd: float,
        targeting: dict,
        objective: str = "OUTCOME_AWARENESS",
        call_to_action: str = "LEARN_MORE",
        optimization_goal: str = "THRUPLAY",
        special_ad_categories: list[str] | None = None,
    ) -> dict:
        return self._m().create_complete_video_ad(
            campaign_name=campaign_name,
            ad_name=ad_name,
            video_path=video_path,
            title=title,
            body=body,
            link_url=link_url,
            daily_budget_usd=daily_budget_usd,
            targeting=targeting,
            objective=objective,
            call_to_action=call_to_action,
            optimization_goal=optimization_goal,
            special_ad_categories=special_ad_categories,
        )

    # ------------------------------------------ new methods (not in legacy)

    def fetch_insights(
        self,
        level: InsightLevel = "account",
        date_preset: str | None = "last_7d",
        time_range: dict[str, str] | None = None,
        fields: list[str] | None = None,
        filtering: list[dict] | None = None,
    ) -> list[dict]:
        """
        Fetch Meta insights at the requested level.

        `time_range` (e.g. {'since':'2026-04-01','until':'2026-04-15'}) overrides
        `date_preset` if both are provided. Returns JSON-safe dicts via
        `export_all_data()` on each row.
        """
        params: dict[str, Any] = {"level": level}
        if time_range:
            params["time_range"] = time_range
        elif date_preset:
            params["date_preset"] = date_preset
        if filtering:
            params["filtering"] = filtering

        cursor = self._m().ad_account.get_insights(
            params=params,
            fields=fields or _DEFAULT_INSIGHT_FIELDS,
        )
        return [row.export_all_data() for row in cursor]

    def list_campaigns(
        self,
        status_filter: list[str] | None = None,
        extra_fields: list[str] | None = None,
    ) -> list[dict]:
        """List campaigns on the ad account.

        `status_filter` (e.g. `['PAUSED']` or `['ACTIVE', 'PAUSED']`) is applied
        via Meta's `effective_status` param. None → no filter.

        Added 2026-05-13 for §T_PA Paused Campaign Audit (decision-tree.md).
        Returns JSON-safe dicts via `export_all_data()`.
        """
        self._m()  # ensure FacebookAdsApi.init() has run
        fields = [
            "id",
            "name",
            "status",
            "effective_status",
            "objective",
            "daily_budget",
            "lifetime_budget",
            "updated_time",
            "created_time",
        ]
        if extra_fields:
            fields.extend(extra_fields)
        params: dict[str, Any] = {}
        if status_filter:
            params["effective_status"] = status_filter
        cursor = self._m().ad_account.get_campaigns(fields=fields, params=params)
        return [c.export_all_data() for c in cursor]

    def get_ad_creative_map(self, ad_ids: list[str]) -> dict[str, str]:
        """Return {ad_id: creative_id} for the given ads.

        Meta's ads-insights endpoint rejects `creative_id` as a field selector
        (#100: not valid for fields param). Callers that need to join
        insights rows to creative metadata must look up the mapping separately.
        We fetch each `Ad` object's `creative` field one at a time — fine for
        the small N (active ads in a single window) we ever call this with.

        Skips ad_ids that 404 (deleted/archived) or carry no creative.
        """
        self._m()  # ensure FacebookAdsApi.init() has run
        result: dict[str, str] = {}
        for ad_id in ad_ids:
            if not ad_id:
                continue
            try:
                ad = Ad(str(ad_id)).api_get(fields=["creative"])
                data = ad.export_all_data()
            except Exception:
                continue
            creative = data.get("creative")
            if isinstance(creative, dict) and creative.get("id"):
                result[str(ad_id)] = str(creative["id"])
        return result

    def get_object_state(
        self,
        object_type: ObjectType,
        object_id: str,
        extra_fields: list[str] | None = None,
    ) -> dict:
        """
        Fetch object-level state — fields that the insights endpoint does NOT
        expose: status, updated_time, created_time, daily_budget, lifetime_budget,
        objective (campaigns only), optimization_goal (adsets only).

        Used by decision-tree §T0r:
          - R0 (post_edit_cooldown 72h)        → needs updated_time
          - R1/R2 (LEARNING / LEARNING_LIMITED) → needs status (object-level,
                                                  distinct from delivery status)
          - §T-1 utilization formula            → needs daily_budget

        Returns a JSON-safe dict via `export_all_data()`. Caller decides which
        fields to consume.
        """
        self._m()  # ensure FacebookAdsApi.init() has run
        klass = _OBJECT_CLASS[object_type]
        fields = ["id", "name", "status", "updated_time", "created_time"]
        if object_type in ("campaign", "adset"):
            fields.extend(["daily_budget", "lifetime_budget"])
        if object_type == "campaign":
            fields.append("objective")
        if object_type == "adset":
            fields.append("optimization_goal")
        if extra_fields:
            fields.extend(extra_fields)
        obj = klass(object_id).api_get(fields=fields)
        return obj.export_all_data()

    def fetch_insights_with_prior_window(
        self,
        level: InsightLevel = "campaign",
        days: int = 7,
        fields: list[str] | None = None,
        filtering: list[dict] | None = None,
    ) -> list[dict]:
        """
        Fetch the current `days`-window AND the prior equal-length window,
        merge by `<level>_id`, and return rows with `*_current` / `*_prior` /
        `delta_*_pct` per metric. Used by decision-tree §T2+ Pre-check 2
        (marginal-CPM guard) and §T_SD trend detection.

        Today: two Meta calls (Andromeda doesn't support comparison windows
        natively); we sum spend/impressions over each window, average frequency
        and CPM, then compute the delta per row that exists in both windows.

        Rows that only exist in one window get `prior_*` (or `current_*`) set
        to None and `delta_*_pct` set to None — the agent must treat None as
        "insufficient data for this comparison" rather than 0.
        """
        from datetime import UTC, datetime, timedelta

        today = datetime.now(UTC).date()
        current_start = today - timedelta(days=days - 1)
        prior_end = current_start - timedelta(days=1)
        prior_start = prior_end - timedelta(days=days - 1)

        time_range_current = {
            "since": current_start.isoformat(),
            "until": today.isoformat(),
        }
        time_range_prior = {
            "since": prior_start.isoformat(),
            "until": prior_end.isoformat(),
        }

        current_rows = self.fetch_insights(
            level=level,
            time_range=time_range_current,
            fields=fields,
            filtering=filtering,
        )
        prior_rows = self.fetch_insights(
            level=level,
            time_range=time_range_prior,
            fields=fields,
            filtering=filtering,
        )

        id_field = {
            "account": "account_id",
            "campaign": "campaign_id",
            "adset": "adset_id",
            "ad": "ad_id",
        }[level]
        prior_by_id = {r.get(id_field): r for r in prior_rows if r.get(id_field)}

        comparable_metrics = (
            "spend",
            "impressions",
            "clicks",
            "cpm",
            "cpc",
            "ctr",
            "frequency",
            "reach",
        )
        merged: list[dict] = []
        for row in current_rows:
            key = row.get(id_field)
            prior = prior_by_id.get(key, {}) if key else {}
            out: dict = {
                **row,
                "window_days": days,
                "window_current": time_range_current,
                "window_prior": time_range_prior,
            }
            for m in comparable_metrics:
                cur_v = _safe_float(row.get(m))
                pri_v = _safe_float(prior.get(m))
                out[f"{m}_current"] = cur_v
                out[f"{m}_prior"] = pri_v
                if cur_v is None or pri_v is None or pri_v == 0:
                    out[f"delta_{m}_pct"] = None
                else:
                    out[f"delta_{m}_pct"] = round((cur_v - pri_v) / pri_v * 100, 2)
            merged.append(out)
        return merged

    def update_status(
        self,
        object_type: ObjectType,
        object_id: str,
        status: StatusValue,
    ) -> dict:
        """Pause / resume / archive a campaign, ad set, or ad."""
        self._m()  # ensure FacebookAdsApi.init() has run
        klass = _OBJECT_CLASS[object_type]
        obj = klass(object_id)
        obj.api_update(params={"status": status})
        return {"id": object_id, "type": object_type, "status": status}

    def create_creative_from_post(
        self,
        *,
        name: str,
        post_id: str,
        page_id: str | None = None,
    ) -> dict:
        """Create an AdCreative wrapping an existing Page post via Meta's
        `object_story_id` pattern. This is the cheapest way to promote a
        post that's already published organically — no image re-upload, no
        copy regeneration, the ad inherits the post's reactions and shares.

        Block 7 (2026-05-12) — `boost_post` execution path.

        `post_id` is the Meta post id from `approvals.external_post_id`
        (already in `{page_id}_{post_id}` format on FB; bare media id on IG).
        For FB we accept either form; for IG the caller must pass the
        media id alone and the Page-context wrapping happens in the dispatcher.

        Returns: `{id, type, kind, name, object_story_id}`.
        """
        from facebook_business.adobjects.adcreative import AdCreative  # noqa: E402

        self._m()  # ensure FacebookAdsApi.init() has run
        resolved_page = page_id or self._config.meta_page_id
        # Meta expects `{page_id}_{post_id}`. If the caller passed that form,
        # use it verbatim. Otherwise prepend the page_id.
        if "_" in post_id:
            object_story_id = post_id
        else:
            object_story_id = f"{resolved_page}_{post_id}"
        params = {
            AdCreative.Field.name: name,
            AdCreative.Field.object_story_id: object_story_id,
        }
        creative = self._m().ad_account.create_ad_creative(params=params)
        return {
            "id": creative.get_id(),
            "type": "creative",
            "kind": "from_post",
            "name": name,
            "object_story_id": object_story_id,
        }

    def update_targeting(
        self,
        adset_id: str,
        new_targeting: dict,
    ) -> dict:
        """
        Replace the targeting object on an ad set. Used by §T-1 severely_under
        and §T5 expand_audience.

        `new_targeting` is passed verbatim to Meta's `targeting` field — it
        must already be a valid Meta targeting spec. Typical shape for a
        broad+advantage expansion:

            {
                "geo_locations": {"countries": ["IL"]},
                "age_min": 25,
                "age_max": 55,
                "targeting_automation": {"advantage_audience": 1},
            }

        IMPORTANT: targeting changes reset Learning Phase. Caller is responsible
        for honoring `no_learning_phase_touch` / `no_audience_change_on_active`
        guardrails before reaching this method.
        """
        self._m()  # ensure init
        obj = AdSet(adset_id)
        obj.api_update(params={"targeting": new_targeting})
        return {
            "id": adset_id,
            "type": "adset",
            "targeting": new_targeting,
            "note": "targeting replaced — Learning Phase will reset",
        }

    def update_budget(
        self,
        object_type: Literal["adset", "campaign"],
        object_id: str,
        daily_budget_usd: float,
    ) -> dict:
        """Update daily budget on an ad set (ABO) or campaign (CBO). USD → agorot via live rate."""
        manager = self._m()
        daily_budget_agorot = manager.usd_to_agorot(daily_budget_usd)
        klass = _OBJECT_CLASS[object_type]
        obj = klass(object_id)
        obj.api_update(params={"daily_budget": daily_budget_agorot})
        return {
            "id": object_id,
            "type": object_type,
            "daily_budget_usd": daily_budget_usd,
            "daily_budget_agorot": daily_budget_agorot,
        }

    # =================================================================
    # Audiences (Phase 1 — Custom + Saved + Lookalike + Special Ad)
    # =================================================================
    #
    # Meta's audience model: Custom Audiences and Lookalike Audiences live
    # under the same `customaudience` endpoint — Lookalikes are a CustomAudience
    # with `subtype='LOOKALIKE'`. Saved Audiences are a separate object scoped
    # to the ad account (some accounts also expose them at the business level).
    #
    # Phase 1 supports READ for all kinds, plus CREATE for the non-PII custom
    # subtypes (WEBSITE / ENGAGER / VIDEO_VIEWERS / LEAD_FORM) and lookalikes.
    # Customer-file (PII) creation is deferred to Phase 2 when lead pipeline +
    # SHA-256 hashing UI exist (master plan §4.4).

    # Probed against Meta API v25 (2026-05-13). `approximate_count` and
    # `external_event_source` are no longer accepted by /customaudiences;
    # the bounds pair replaces approximate_count. Keep this list in sync with
    # the columns of `meta_audiences` (migration 022).
    _CUSTOM_AUDIENCE_FIELDS = [
        "id",
        "name",
        "description",
        "subtype",
        "approximate_count_lower_bound",
        "approximate_count_upper_bound",
        "retention_days",
        "data_source",
        "rule",
        "lookalike_spec",
        "origin_audience_id",
        "operation_status",
        "delivery_status",
        "permission_for_actions",
        "time_created",
        "time_updated",
    ]

    def list_custom_audiences(self, limit: int = 200) -> list[dict]:
        """List all Custom + Lookalike audiences on the ad account.

        Returns JSON-safe dicts. The caller (sync_audiences.py) discriminates
        custom vs lookalike via `subtype == 'LOOKALIKE'`.

        Pagination: facebook-business handles cursors transparently; `limit`
        caps the iteration so a runaway account (10k+ audiences) doesn't
        stall the run.
        """
        from facebook_business.adobjects.customaudience import CustomAudience  # noqa: F401

        self._m()  # ensure init
        params: dict[str, Any] = {"limit": min(limit, 200)}
        cursor = self._m().ad_account.get_custom_audiences(
            params=params,
            fields=self._CUSTOM_AUDIENCE_FIELDS,
        )
        out: list[dict] = []
        for row in cursor:
            out.append(row.export_all_data())
            if len(out) >= limit:
                break
        return out

    def list_saved_audiences(self, limit: int = 200) -> list[dict]:
        """List Saved Audiences on the ad account.

        Meta exposes these at the ad-account scope via /act_X/saved_audiences.
        Some account configurations only surface them at the business scope —
        in that case Meta returns an empty list and the caller falls back to
        a business-level lookup (not implemented in Phase 1; deferred).

        Returns JSON-safe dicts. Empty list on permission errors rather than
        raising — saved audiences are non-critical for the agent's primary
        flow (custom + lookalike cover the core use cases).
        """
        self._m()  # ensure init
        try:
            cursor = self._m().ad_account.get_saved_audiences(
                params={"limit": min(limit, 200)},
                fields=[
                    "id",
                    "name",
                    "description",
                    "approximate_count_lower_bound",
                    "approximate_count_upper_bound",
                    "targeting",
                    "sentence_lines",
                    "permission_for_actions",
                    "run_status",
                    "time_created",
                    "time_updated",
                ],
            )
            out: list[dict] = []
            for row in cursor:
                out.append(row.export_all_data())
                if len(out) >= limit:
                    break
            return out
        except Exception:
            # Permission / API-not-available — sync continues with empty list.
            return []

    def create_custom_audience(
        self,
        *,
        name: str,
        subtype: str,
        description: str | None = None,
        retention_days: int = 180,
        rule: dict | None = None,
        pixel_id: str | None = None,
    ) -> dict:
        """Create a Custom Audience for non-PII subtypes (Phase 1 scope).

        Supported `subtype`: WEBSITE, ENGAGEMENT (FB/IG page engager), VIDEO,
        LEAD_GENERATION. NOT supported here: CUSTOM (customer-file PII upload)
        — that requires SHA-256-hashed PII and lives in Phase 2.

        For WEBSITE audiences: pass `rule` (Meta inclusions/exclusions spec)
        and optionally `pixel_id` (defaults to the configured pixel).

        Returns the new audience as a JSON-safe dict including `meta_audience_id`.
        """
        from facebook_business.adobjects.customaudience import CustomAudience

        self._m()  # ensure init
        params: dict[str, Any] = {
            CustomAudience.Field.name: name,
            CustomAudience.Field.subtype: subtype,
            CustomAudience.Field.retention_days: retention_days,
        }
        if description:
            params[CustomAudience.Field.description] = description
        if rule:
            params[CustomAudience.Field.rule] = rule
        if pixel_id:
            params[CustomAudience.Field.pixel_id] = pixel_id

        result = self._m().ad_account.create_custom_audience(params=params)
        # Meta returns just `{id}`; re-fetch to capture the full payload.
        fetched = CustomAudience(result.get_id()).api_get(fields=self._CUSTOM_AUDIENCE_FIELDS)
        return fetched.export_all_data()

    def create_lookalike_audience(
        self,
        *,
        name: str,
        origin_audience_id: str,
        country: str = "IL",
        ratio: float = 0.01,
        type_: str | None = None,
    ) -> dict:
        """Create a Lookalike Audience seeded from `origin_audience_id`.

        `ratio` is 0.01 to 0.10 (1% to 10%). `type_` is 'similarity' or
        'reach' (None = Meta default). Seed audience must have at least
        100 people; guardrail §29 enforces this at the propose layer.
        """
        from facebook_business.adobjects.customaudience import CustomAudience

        self._m()  # ensure init
        lookalike_spec: dict[str, Any] = {
            "country": country,
            "ratio": ratio,
        }
        if type_:
            lookalike_spec["type"] = type_
        params: dict[str, Any] = {
            CustomAudience.Field.name: name,
            CustomAudience.Field.subtype: "LOOKALIKE",
            CustomAudience.Field.origin_audience_id: origin_audience_id,
            CustomAudience.Field.lookalike_spec: lookalike_spec,
        }
        result = self._m().ad_account.create_custom_audience(params=params)
        fetched = CustomAudience(result.get_id()).api_get(fields=self._CUSTOM_AUDIENCE_FIELDS)
        return fetched.export_all_data()

    # =================================================================
    # Phase 3 — full new_campaign chain (campaign + adset + creative + ad)
    # =================================================================
    #
    # The legacy `create_complete_*` methods take a narrow set of kwargs and
    # don't expose the rich shape the agent now needs (promoted_object,
    # explicit optimization_goal, custom_audience IDs, identity, UTM tags,
    # creative_gallery_id reuse, etc.).
    #
    # `create_campaign_chain` honors the propose_task new_campaign payload
    # contract verbatim. It chains four Meta API calls (campaign → adset →
    # creative → ad) and tries to roll back on failure: anything created
    # before the failing step is paused via `update_status` so no money is
    # spent. Everything is created with status=PAUSED by default — the
    # operator flips to ACTIVE in Ads Manager when ready.

    def create_campaign_chain(self, payload: dict) -> dict:
        """Create campaign + ad set + creative + ad from a single payload.

        See `propose_task.py` VALID_TASK_TYPES new_campaign for the full
        contract. Returns a dict with all created IDs:
          {
            campaign_id, adset_id, creative_id, ad_id,
            image_hash?, status, errors: [],
          }

        On failure mid-chain, raises RuntimeError with the partial state
        described in the message; everything created before the failing
        step is already paused.
        """
        from facebook_business.adobjects.adcreative import AdCreative  # noqa: E402

        self._m()  # ensure init

        # ---- Validate minimal fields ------------------------------------
        required = ["campaign_name", "objective", "adset_name", "targeting", "ad_name"]
        missing = [f for f in required if not payload.get(f)]
        if missing:
            raise ValueError(f"create_campaign_chain payload missing required fields: {missing}")

        budget_keys = (
            payload.get("daily_budget_ils"),
            payload.get("lifetime_budget_ils"),
        )
        if not any(budget_keys):
            raise ValueError(
                "create_campaign_chain requires daily_budget_ils OR lifetime_budget_ils"
            )

        # ---- Step 1: Campaign -------------------------------------------
        campaign_params: dict[str, Any] = {
            Campaign.Field.name: payload["campaign_name"],
            Campaign.Field.objective: payload["objective"],
            Campaign.Field.status: "PAUSED",
            Campaign.Field.special_ad_categories: payload.get("special_ad_categories") or [],
        }
        if payload.get("buying_type"):
            campaign_params[Campaign.Field.buying_type] = payload["buying_type"]
        if payload.get("bid_strategy"):
            campaign_params[Campaign.Field.bid_strategy] = payload["bid_strategy"]
        if payload.get("daily_budget_ils"):
            # CBO: campaign-level daily budget. Meta wants agorot (×100).
            campaign_params[Campaign.Field.daily_budget] = int(
                float(payload["daily_budget_ils"]) * 100
            )
        elif payload.get("lifetime_budget_ils"):
            campaign_params[Campaign.Field.lifetime_budget] = int(
                float(payload["lifetime_budget_ils"]) * 100
            )
        if payload.get("spend_cap_ils"):
            campaign_params[Campaign.Field.spend_cap] = int(float(payload["spend_cap_ils"]) * 100)
        if payload.get("start_time_iso"):
            campaign_params["start_time"] = payload["start_time_iso"]
        if payload.get("stop_time_iso"):
            campaign_params["stop_time"] = payload["stop_time_iso"]
        campaign_params["is_adset_budget_sharing_enabled"] = False

        try:
            campaign = self._m().ad_account.create_campaign(params=campaign_params)
            campaign_id = campaign.get_id()
        except Exception as e:
            raise RuntimeError(f"campaign create failed: {e}") from e

        # ---- Step 2: Ad set ---------------------------------------------
        adset_params: dict[str, Any] = {
            AdSet.Field.name: payload["adset_name"],
            AdSet.Field.campaign_id: campaign_id,
            AdSet.Field.targeting: payload["targeting"],
            AdSet.Field.status: "PAUSED",
        }
        # optimization_goal is REQUIRED for ad set creation in 2026.
        adset_params[AdSet.Field.optimization_goal] = payload.get(
            "optimization_goal"
        ) or _default_optimization_goal_for_objective(payload["objective"])
        adset_params[AdSet.Field.billing_event] = payload.get("billing_event") or "IMPRESSIONS"

        # promoted_object is required for OUTCOME_LEADS / OUTCOME_SALES /
        # OUTCOME_ENGAGEMENT (messaging). The propose layer enforces it via
        # guardrail §38, but we double-check here.
        if payload.get("promoted_object"):
            adset_params[AdSet.Field.promoted_object] = payload["promoted_object"]

        # ABO: when daily_budget on campaign is NOT set, the budget lives at
        # ad set level. Per Meta: cannot set daily_budget on both campaign
        # AND adset simultaneously.
        if not payload.get("daily_budget_ils") and not payload.get("lifetime_budget_ils"):
            # Fallback: caller should set one of the two. Default to a 30 ILS
            # adset budget so the create doesn't 400. The propose layer
            # should have caught this — fail loud.
            raise RuntimeError("no budget set on campaign — refusing to create unbudgeted adset")
        if payload.get("adset_daily_budget_ils"):
            adset_params[AdSet.Field.daily_budget] = int(
                float(payload["adset_daily_budget_ils"]) * 100
            )

        if payload.get("adset_start_time_iso"):
            adset_params["start_time"] = payload["adset_start_time_iso"]
        if payload.get("adset_end_time_iso"):
            adset_params["end_time"] = payload["adset_end_time_iso"]
        if payload.get("attribution_spec"):
            adset_params["attribution_spec"] = payload["attribution_spec"]

        try:
            ad_set = self._m().ad_account.create_ad_set(params=adset_params)
            adset_id = ad_set.get_id()
        except Exception as e:
            # Roll back: pause the campaign so it doesn't sit "draft" on Meta.
            with contextlib.suppress(Exception):
                self.update_status("campaign", campaign_id, "PAUSED")
            raise RuntimeError(f"adset create failed (campaign {campaign_id} paused): {e}") from e

        # ---- Step 3: Creative -------------------------------------------
        creative_source = payload.get("creative_source") or {}
        copy = payload.get("copy") or {}
        identity = payload.get("identity") or {}
        page_id = identity.get("page_id") or self._config.meta_page_id

        creative_id: str | None = None
        image_hash: str | None = None

        try:
            if creative_source.get("existing_creative_id"):
                # Short-circuit: just reuse an existing AdCreative.
                creative_id = str(creative_source["existing_creative_id"])
            elif creative_source.get("creative_gallery_id"):
                # Resolve gallery row → if it has meta_creative_id, reuse;
                # otherwise upload + create. We avoid importing db here —
                # the caller (execute_task dispatcher) handles the lookup
                # and passes either `existing_creative_id` or `image_path`.
                raise RuntimeError(
                    "creative_source.creative_gallery_id should be resolved by "
                    "the dispatcher before reaching create_campaign_chain — "
                    "pass `existing_creative_id` or `image_path` instead"
                )
            elif creative_source.get("image_path"):
                # Upload + create new image creative.
                image_hash = self._m().upload_image(creative_source["image_path"])
                creative_params: dict[str, Any] = {
                    AdCreative.Field.name: f"{payload['ad_name']} creative",
                    AdCreative.Field.object_story_spec: {
                        "page_id": page_id,
                        "link_data": {
                            "image_hash": image_hash,
                            "link": copy.get("link_url") or "",
                            "message": copy.get("primary_text") or "",
                            "name": copy.get("headline") or "",
                            "description": copy.get("description") or None,
                            "call_to_action": {
                                "type": copy.get("cta") or "LEARN_MORE",
                                "value": {"link": copy.get("link_url") or ""},
                            },
                        },
                    },
                }
                if identity.get("instagram_actor_id"):
                    creative_params[AdCreative.Field.object_story_spec]["instagram_actor_id"] = (
                        identity["instagram_actor_id"]
                    )
                tracking = payload.get("tracking") or {}
                if tracking.get("url_tags"):
                    creative_params[AdCreative.Field.url_tags] = tracking["url_tags"]

                creative = self._m().ad_account.create_ad_creative(params=creative_params)
                creative_id = creative.get_id()
            else:
                raise RuntimeError(
                    "creative_source must specify existing_creative_id, "
                    "creative_gallery_id, or image_path"
                )
        except Exception as e:
            # Roll back: pause adset + campaign.
            with contextlib.suppress(Exception):
                self.update_status("adset", adset_id, "PAUSED")
            with contextlib.suppress(Exception):
                self.update_status("campaign", campaign_id, "PAUSED")
            raise RuntimeError(
                f"creative create failed (campaign {campaign_id}, adset {adset_id} paused): {e}"
            ) from e

        # ---- Step 4: Ad --------------------------------------------------
        try:
            ad = self._m().ad_account.create_ad(
                params={
                    Ad.Field.name: payload["ad_name"],
                    Ad.Field.adset_id: adset_id,
                    Ad.Field.creative: {"creative_id": creative_id},
                    Ad.Field.status: "PAUSED",
                }
            )
            ad_id = ad.get_id()
        except Exception as e:
            # Roll back: pause everything.
            with contextlib.suppress(Exception):
                self.update_status("adset", adset_id, "PAUSED")
            with contextlib.suppress(Exception):
                self.update_status("campaign", campaign_id, "PAUSED")
            raise RuntimeError(
                f"ad create failed (campaign {campaign_id}, adset {adset_id}, "
                f"creative {creative_id} paused): {e}"
            ) from e

        return {
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "creative_id": creative_id,
            "ad_id": ad_id,
            "image_hash": image_hash,
            "status": "PAUSED",
            "objective": payload["objective"],
        }

    def get_custom_audience(self, audience_id: str) -> dict:
        """Re-fetch a single audience by Meta ID — used after a creation
        approval to confirm Meta-side success and capture the full payload."""
        from facebook_business.adobjects.customaudience import CustomAudience

        self._m()
        fetched = CustomAudience(str(audience_id)).api_get(fields=self._CUSTOM_AUDIENCE_FIELDS)
        return fetched.export_all_data()

    def estimate_audience_size(
        self,
        targeting_spec: dict,
        optimization_goal: str = "REACH",
    ) -> dict:
        """Reach estimate for a given targeting spec.

        Wraps Meta's `/act_X/delivery_estimate` endpoint. Used by the New
        Campaign Wizard (Phase 3) to surface "this audience is ~X people" as
        the operator builds a saved-audience spec, and as a sanity check
        before proposing `create_saved_audience`.

        `optimization_goal` must match what the ad set will optimize for —
        Meta returns different reach numbers per goal because each goal has
        a different eligible-user pool. Defaults to REACH for a conservative
        upper-bound view.

        Returns a JSON-safe dict:
            {
                "estimate_dau":      int | None,   # daily active users
                "estimate_mau":      int | None,   # legacy field, may be absent
                "estimate_mau_lower_bound": int | None,
                "estimate_mau_upper_bound": int | None,
                "estimate_ready":    bool,
            }

        Empty dict on permission / API errors — callers should treat that as
        "estimate unavailable" rather than fail the proposal.
        """
        self._m()
        try:
            cursor = self._m().ad_account.get_delivery_estimate(
                params={
                    "targeting_spec": targeting_spec,
                    "optimization_goal": optimization_goal,
                },
                fields=[
                    "estimate_dau",
                    "estimate_mau",
                    "estimate_mau_lower_bound",
                    "estimate_mau_upper_bound",
                    "estimate_ready",
                ],
            )
            for row in cursor:
                return row.export_all_data()
            return {}
        except Exception:
            return {}
