"""
tools/compute_state_hash.py — Skip-on-no-change gate (focused-run lever #3).

Returns a short fingerprint of "what has changed since last successful run of
this flow on this business". The agent compares it to the hash stored on its
last `boot` decision; if equal, it can skip the entire diagnostic body and
exit with a `skip` decision.

Why this matters
----------------
A daily-observe-propose run that does 76 turns of fetch_insights + diagnose +
log_decision on an account where nothing changed since yesterday produces zero
new information for the operator. The cost is wasted — both in $ and in
operator inbox noise.

What we hash
------------
- Number of `ACTIVE` campaigns + most recent campaign `updated_time` (Meta side)
- Spend bucket (rounded to nearest ₪50) — small changes don't move pace decisions
- Pending approvals count + max(created_at)
- Tracking health status (operator may have flipped a flag overnight)
- Account health band

These are the *inputs* to the agent's decisions. If they're stable, the
decisions won't change. We deliberately do **not** include time-of-day or
per-impression metrics — those drift constantly without driving decisions.

Output
------
```
{
  "business_id": "...",
  "flow": "daily_observe_propose",
  "state_hash": "a3f1...",     -- 12-char hex
  "computed_at": "ISO8601",
  "components": {
    "active_campaign_count": 1,
    "last_campaign_updated_time": "...",
    "spend_bucket_ils": 1400,
    "pending_approvals_count": 8,
    "last_pending_created_at": "...",
    "tracking_status": "partial",
    "health_band": "healthy"
  },
  "previous_hash": "...",      -- last hash for this flow+business, or null
  "should_skip": bool,         -- shortcut: previous_hash != null && equal
  "previous_run_id": "...",    -- pointer for the skip decision's rationale
  "previous_run_at": "ISO8601"
}
```

The agent reads `should_skip` and either continues or short-circuits.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_all, fetch_one
from campaigner.lib.fx import convert_to_ils
from campaigner.lib.meta_client import MetaClient
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Bucket spend so pace decisions don't flip from a ₪0.50 swing.
SPEND_BUCKET_ILS = 50.0


def _spend_bucket(amount_ils: float) -> int:
    return int(math.floor(amount_ils / SPEND_BUCKET_ILS) * SPEND_BUCKET_ILS)


def _build_components(business_id: str) -> dict:
    """Pull the small set of state inputs we hash. Never raises — missing
    pieces become `null` so the hash still computes, just with degraded
    discrimination on that dimension."""

    out: dict = {
        "active_campaign_count": None,
        "last_campaign_updated_time": None,
        "spend_bucket_ils": None,
        "pending_approvals_count": None,
        "last_pending_created_at": None,
        "tracking_status": None,
        "health_band": None,
    }

    # Pending approvals snapshot — pure DB, can't fail in practice.
    try:
        rows = with_db_retry(
            lambda: fetch_all(
                """
                SELECT COUNT(*) AS n, MAX(created_at) AS last_at
                  FROM approvals
                 WHERE business_id = %s AND status = 'pending'
                """,
                (business_id,),
            )
        )
        if rows:
            out["pending_approvals_count"] = int(rows[0].get("n") or 0)
            last_at = rows[0].get("last_at")
            out["last_pending_created_at"] = last_at.isoformat() if last_at else None
    except Exception:
        pass

    # Most recent tracking_health observation — flag flips between runs.
    try:
        track = with_db_retry(
            lambda: fetch_one(
                """
                SELECT outputs
                  FROM agent_decisions
                 WHERE business_id = %s
                   AND node_name = 'tracking_health'
                   AND decision_type = 'observation'
                 ORDER BY created_at DESC
                 LIMIT 1
                """,
                (business_id,),
            )
        )
        if track and track.get("outputs"):
            out["tracking_status"] = track["outputs"].get("status")
    except Exception:
        pass

    # Most recent account_health observation.
    try:
        acct = with_db_retry(
            lambda: fetch_one(
                """
                SELECT outputs
                  FROM agent_decisions
                 WHERE business_id = %s
                   AND node_name = 'account_health'
                   AND decision_type = 'observation'
                 ORDER BY created_at DESC
                 LIMIT 1
                """,
                (business_id,),
            )
        )
        if acct and acct.get("outputs"):
            out["health_band"] = acct["outputs"].get("health_band")
    except Exception:
        pass

    # Meta side — active campaign count + most recent campaign edit time + spend.
    # If Meta is unreachable we leave these null; the hash will still differ
    # day-to-day via pending approvals or DB-side observations.
    try:
        config = Config.load()
        client = MetaClient(config)
        campaigns = client.list_campaigns(status_filter=["ACTIVE"], extra_fields=["updated_time"])
        out["active_campaign_count"] = len(campaigns)
        if campaigns:
            updated = [c.get("updated_time") for c in campaigns if c.get("updated_time")]
            if updated:
                out["last_campaign_updated_time"] = max(updated)

        today = datetime.now(UTC).date()
        month_start = today.replace(day=1).isoformat()
        rows = client.fetch_insights(
            level="account",
            time_range={"since": month_start, "until": today.isoformat()},
            fields=["spend", "account_currency"],
        )
        if rows:
            spend_native = 0.0
            currency = None
            for r in rows:
                s = r.get("spend")
                if s is not None:
                    with contextlib.suppress(TypeError, ValueError):
                        spend_native += float(s)
                if currency is None and r.get("account_currency"):
                    currency = r["account_currency"]
            spend_ils, _, _, _ = convert_to_ils(spend_native, currency)
            out["spend_bucket_ils"] = _spend_bucket(spend_ils)
    except Exception:
        pass

    return out


def _hash_components(components: dict) -> str:
    payload = json.dumps(components, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def _previous_hash_for(business_id: str, flow: str) -> tuple[str | None, str | None, str | None]:
    """Lookup most recent `state_hash` observation for this flow + business.

    Returns (hash, run_id, created_at_iso) or (None, None, None) if no
    previous run is recorded. Only considers boot decisions from the same
    flow, so flow-A and flow-B don't cross-pollinate.
    """
    try:
        row = with_db_retry(
            lambda: fetch_one(
                """
                SELECT run_id::text, created_at, outputs
                  FROM agent_decisions
                 WHERE business_id = %s
                   AND graph_name = %s
                   AND node_name = 'state_hash'
                   AND decision_type = 'observation'
                 ORDER BY created_at DESC
                 LIMIT 1
                """,
                (business_id, flow),
            )
        )
    except Exception:
        return None, None, None
    if not row:
        return None, None, None
    outputs = row.get("outputs") or {}
    prev = outputs.get("state_hash")
    created = row.get("created_at")
    return (
        prev,
        row.get("run_id"),
        created.isoformat() if created else None,
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compute a state fingerprint for skip-on-no-change gating.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--flow",
        required=True,
        help="Flow name (e.g. observe_propose) — used to scope previous-hash lookup.",
    )
    p.add_argument(
        "--max-skip-age-hours",
        type=float,
        default=26.0,
        help=(
            "Don't suggest skip if the previous matching hash is older than this. "
            "Default 26h covers daily cron with a 2h slack window. Set to 0 to "
            "disable the age check (always skip on match)."
        ),
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        components = _build_components(args.business_id)
    except Exception as e:
        emit_runtime_error(f"state-hash component computation failed: {e}", exc=e)
        return

    current_hash = _hash_components(components)
    previous_hash, previous_run_id, previous_run_at = _previous_hash_for(
        args.business_id, args.flow
    )

    should_skip = False
    if previous_hash and previous_hash == current_hash:
        if args.max_skip_age_hours <= 0:
            should_skip = True
        elif previous_run_at:
            try:
                prev_dt = datetime.fromisoformat(previous_run_at)
                if prev_dt.tzinfo is None:
                    prev_dt = prev_dt.replace(tzinfo=UTC)
                age = datetime.now(UTC) - prev_dt
                if age < timedelta(hours=args.max_skip_age_hours):
                    should_skip = True
            except ValueError:
                pass

    emit_success(
        {
            "business_id": args.business_id,
            "flow": args.flow,
            "state_hash": current_hash,
            "computed_at": datetime.now(UTC).isoformat(),
            "components": components,
            "previous_hash": previous_hash,
            "previous_run_id": previous_run_id,
            "previous_run_at": previous_run_at,
            "should_skip": should_skip,
            "skip_age_threshold_hours": args.max_skip_age_hours,
        }
    )


if __name__ == "__main__":
    main()
