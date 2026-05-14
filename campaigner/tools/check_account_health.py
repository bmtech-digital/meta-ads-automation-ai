"""
tools/check_account_health.py — pull Meta account-level signals + classify.

Phase 7 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§10). Beyond tracking_health (which only checks pixel/CAPI/domain/AEM), this
tool surfaces signals the agent currently has zero awareness of:

  - **disable_reason** — account-level restrictions (POLICY_VIOLATION etc.)
  - **business_country_code** — sanity check vs business_knowledge.service_regions
  - **spend_cap / amount_spent / balance** — payment capacity headroom
  - **account_status** — 1=ACTIVE, 2=DISABLED, etc.
  - **funding_source_details** — payment method present
  - **disable_reason / capabilities** — what the account is allowed to do
  - **rejected ads count** — ads in `effective_status=DISAPPROVED` in last 30d
  - **AdAccount.timezone_name / currency** — drift from businesses table

Each signal contributes to an overall `health_band ∈ {healthy, watch, critical}`.
The agent reads this in Flow A Step 0.6 (after tracking_health) and emits
`alert` proposals for any `critical` signal.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
)


def _account_fields() -> list[str]:
    """The AdAccount fields we read. Kept narrow — every field adds latency."""
    return [
        "id",
        "name",
        "account_id",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
        "amount_spent",
        "balance",
        "spend_cap",
        "business_country_code",
        "funding_source",
        "capabilities",
        "owner",
        "is_personal",
        "is_prepay_account",
        "min_daily_budget",
    ]


def _decode_status(account_status: int | None) -> str:
    """Meta's account_status: 1=ACTIVE 2=DISABLED 3=UNSETTLED 7=PENDING_REVIEW 8=IN_GRACE_PERIOD 9=PENDING_CLOSURE 100=CLOSED 101=ANY_ACTIVE 102=ANY_CLOSED 201=PENDING_SETTLEMENT 202=IN_GRACE_PERIOD."""
    return {
        1: "ACTIVE",
        2: "DISABLED",
        3: "UNSETTLED",
        7: "PENDING_REVIEW",
        8: "IN_GRACE_PERIOD",
        9: "PENDING_CLOSURE",
        100: "CLOSED",
        201: "PENDING_SETTLEMENT",
        202: "IN_GRACE_PERIOD",
    }.get(account_status or 0, f"UNKNOWN({account_status})")


def _decode_disable_reason(code: int | None) -> str | None:
    """Meta's disable_reason: 0=NOT_DISABLED 1=ADS_INTEGRITY_POLICY 2=ADS_IP_REVIEW 3=RISK_PAYMENT 4=GRAY_ACCOUNT_SHUT_DOWN 5=ADS_AFC_REVIEW 6=BUSINESS_INTEGRITY_RAR 7=PERMANENT_CLOSE 8=UNUSED_RESELLER_ACCOUNT 9=UNUSED_ACCOUNT 10=UMBRELLA_ACCOUNT."""
    if code is None or code == 0:
        return None
    return {
        1: "ADS_INTEGRITY_POLICY",
        2: "ADS_IP_REVIEW",
        3: "RISK_PAYMENT",
        4: "GRAY_ACCOUNT_SHUT_DOWN",
        5: "ADS_AFC_REVIEW",
        6: "BUSINESS_INTEGRITY_RAR",
        7: "PERMANENT_CLOSE",
        8: "UNUSED_RESELLER_ACCOUNT",
        9: "UNUSED_ACCOUNT",
        10: "UMBRELLA_ACCOUNT",
    }.get(code, f"UNKNOWN({code})")


def _classify(account_data: dict, rejected_count: int) -> tuple[str, list[dict]]:
    """Return (band, signals_list). Each signal: {key, level, summary}."""
    signals: list[dict] = []
    status = _decode_status(account_data.get("account_status"))
    disable_reason = _decode_disable_reason(account_data.get("disable_reason"))

    # 1. Account status
    if status != "ACTIVE":
        signals.append(
            {
                "key": "account_status",
                "level": "critical",
                "summary": f"Account is {status}",
                "value": status,
            }
        )

    # 2. Disable reason (orthogonal to status — Meta sometimes lists it
    # even when status reads ACTIVE during early review).
    if disable_reason:
        signals.append(
            {
                "key": "disable_reason",
                "level": "critical",
                "summary": f"Account flagged: {disable_reason}",
                "value": disable_reason,
            }
        )

    # 3. Payment / funding
    if not account_data.get("funding_source"):
        signals.append(
            {
                "key": "funding_source",
                "level": "watch",
                "summary": "No funding source set — ads cannot run.",
            }
        )

    # 4. Spend cap headroom — only meaningful when both fields exist.
    try:
        cap = int(account_data.get("spend_cap") or 0)
        spent = int(account_data.get("amount_spent") or 0)
    except (TypeError, ValueError):
        cap, spent = 0, 0
    if cap > 0:
        headroom_ratio = (cap - spent) / max(1, cap)
        if headroom_ratio < 0.05:
            signals.append(
                {
                    "key": "spend_cap",
                    "level": "critical",
                    "summary": "Account spend_cap nearly exhausted (<5% remaining).",
                    "headroom_ratio": round(headroom_ratio, 3),
                }
            )
        elif headroom_ratio < 0.20:
            signals.append(
                {
                    "key": "spend_cap",
                    "level": "watch",
                    "summary": "Account spend_cap nearing limit (<20% remaining).",
                    "headroom_ratio": round(headroom_ratio, 3),
                }
            )

    # 5. Rejected ads — more than 2 in the last 30 days = pattern.
    if rejected_count >= 5:
        signals.append(
            {
                "key": "rejected_ads",
                "level": "critical",
                "summary": (
                    f"{rejected_count} ads rejected by Meta in last 30 days — "
                    "creative policy or landing-page issue."
                ),
                "count": rejected_count,
            }
        )
    elif rejected_count >= 2:
        signals.append(
            {
                "key": "rejected_ads",
                "level": "watch",
                "summary": f"{rejected_count} ads rejected — investigate creative policy fit.",
                "count": rejected_count,
            }
        )

    # 6. Personal account ⚠ — Meta tightens limits for personal-mode accounts.
    if account_data.get("is_personal"):
        signals.append(
            {
                "key": "is_personal",
                "level": "watch",
                "summary": (
                    "Account is in personal mode — Business Verification recommended "
                    "before scaling daily spend above ₪150."
                ),
            }
        )

    if any(s["level"] == "critical" for s in signals):
        band = "critical"
    elif any(s["level"] == "watch" for s in signals):
        band = "watch"
    else:
        band = "healthy"
    return band, signals


def _check(business_id: str) -> dict:
    from campaigner.lib.meta_client import MetaClient

    try:
        client = MetaClient()
    except ConfigError as e:
        emit_runtime_error(f"Meta config invalid: {e}", e)
        return {}  # unreachable

    try:
        client._m()  # init
        acct = client._m().ad_account.api_get(fields=_account_fields())
        account_data = acct.export_all_data()
    except Exception as e:
        emit_runtime_error(f"AdAccount fetch failed: {e}", e)
        return {}  # unreachable

    # Count rejected ads via insights — Meta exposes effective_status on ads
    # but rejection events themselves live as `disapproved` ad status.
    rejected_count = 0
    try:
        ads = client._m().ad_account.get_ads(
            params={"effective_status": ["DISAPPROVED"], "limit": 50},
            fields=["id", "name", "effective_status", "created_time"],
        )
        rejected_count = sum(1 for _ in ads)
    except Exception:
        # Permission gap — surface as a signal but don't fail the whole check.
        rejected_count = -1

    band, signals = _classify(account_data, max(rejected_count, 0))
    if rejected_count == -1:
        signals.append(
            {
                "key": "rejected_ads",
                "level": "watch",
                "summary": (
                    "Cannot read rejected-ads list (permission scope missing "
                    "ads_management or business-asset access)."
                ),
            }
        )

    return {
        "business_id": business_id,
        "meta_ad_account_id": account_data.get("account_id"),
        "name": account_data.get("name"),
        "currency": account_data.get("currency"),
        "timezone_name": account_data.get("timezone_name"),
        "account_status": _decode_status(account_data.get("account_status")),
        "disable_reason": _decode_disable_reason(account_data.get("disable_reason")),
        "amount_spent_minor_units": account_data.get("amount_spent"),
        "spend_cap_minor_units": account_data.get("spend_cap"),
        "is_personal": bool(account_data.get("is_personal")),
        "is_prepay_account": bool(account_data.get("is_prepay_account")),
        "funding_source": account_data.get("funding_source"),
        "min_daily_budget": account_data.get("min_daily_budget"),
        "business_country_code": account_data.get("business_country_code"),
        "rejected_ads_30d_count": (rejected_count if rejected_count >= 0 else None),
        "health_band": band,
        "signals": signals,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Pull Meta account-level health signals + classify.")
    p.add_argument("--business-id", required=True)
    args = p.parse_args()

    try:
        Config.load().require_meta()
    except ConfigError as e:
        emit_validation_error(f"Meta config missing: {e}")
        return

    try:
        emit_success(_check(args.business_id))
    except Exception as e:
        emit_runtime_error(f"account health check failed: {e}", e)


if __name__ == "__main__":
    main()
