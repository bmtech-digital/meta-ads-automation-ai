"""
tools/check_tracking_health.py — pre-gate for every Meta-spending proposal.

M1 in decision-map.md / cheeky-seeking-blossom.md §M1. The first link in the
causal chain of diagnosis: if Pixel/CAPI is broken, every downstream signal
the agent reads (conversions, CPA, CPL, ROAS, fatigue ratio) is unreliable —
the agent must alert the operator and refuse to make scaling / creative-add
recommendations on untrusted data.

Reads `business_knowledge.tracking_*` fields (added in migration 008):
  - tracking_verified       — bool, operator-attested "all four green"
  - tracking_pixel_id       — text, the Pixel currently wired
  - tracking_capi_configured — bool, deduplicated CAPI events flowing
  - tracking_aem_priority_events — jsonb, the 8 priority events ranked
  - tracking_domain_verified — text, the verified domain (Meta requires)

For MVP this is the **operator-attested** state — the agent trusts the DB.
A v2 follow-up will add a live Meta call to fetch Pixel event rate + match
quality + last-seen timestamp, and compute a `tracking_freshness_score`.
That's deferred because the Meta API surface for Pixel diagnostics is non-
trivial and the operator-attested flag covers the 90% case (a brand-new
account that hasn't wired CAPI yet).

Output:
  {
    "business_id": "...",
    "status": "healthy" | "unverified" | "partial" | "unknown",
    "verified": bool,
    "checks": [
      {"name": "pixel_id_set", "passed": bool, "value": "..." | None},
      {"name": "capi_configured", "passed": bool},
      {"name": "domain_verified", "passed": bool, "value": "..." | None},
      {"name": "aem_priority_events", "passed": bool, "count": int},
      {"name": "operator_attested_verified", "passed": bool}
    ],
    "blocks_proposals": ["new_campaign", "scale_up", "new_creative", "expand_audience"]
                       — empty when status='healthy',
    "recommended_action": "verify_pixel_capi" | null
  }

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# Task types blocked when status != 'healthy'. Source: §17
# `verify_tracking_infrastructure` extended 2026-05-12 to cover scale-spend
# proposals, not just new_campaign — burning budget on untracked campaigns
# is the same waste regardless of whether the campaign is new or scaled.
BLOCKED_TASKS_WHEN_UNHEALTHY = [
    "new_campaign",
    "scale_up",
    "new_creative",
    "expand_audience",
]


def _check(name: str, passed: bool, **kw) -> dict:
    return {"name": name, "passed": passed, **kw}


def main() -> None:
    p = argparse.ArgumentParser(
        description="Tracking Health pre-gate — block scale-spend proposals when Pixel/CAPI is unverified.",
    )
    p.add_argument("--business-id", required=True)
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        row = with_db_retry(
            lambda: fetch_one(
                """
            SELECT COALESCE(tracking_verified, false)        AS tracking_verified,
                   tracking_pixel_id,
                   COALESCE(tracking_capi_configured, false) AS tracking_capi_configured,
                   tracking_aem_priority_events,
                   tracking_domain_verified
              FROM business_knowledge
             WHERE business_id = %s
             LIMIT 1
            """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business_knowledge fetch failed: {e}", exc=e)
        return

    # No business_knowledge row at all → status unknown. Treat as unhealthy
    # for blocking purposes (the operator hasn't even started the onboarding
    # checklist; we shouldn't spend money on this account yet).
    if row is None:
        emit_success(
            {
                "business_id": args.business_id,
                "status": "unknown",
                "verified": False,
                "checks": [
                    _check(
                        "business_knowledge_row_exists",
                        False,
                        reason="No business_knowledge row found — onboarding incomplete",
                    ),
                ],
                "blocks_proposals": BLOCKED_TASKS_WHEN_UNHEALTHY,
                "recommended_action": "verify_pixel_capi",
            }
        )
        return

    pixel_id = row.get("tracking_pixel_id")
    capi = bool(row.get("tracking_capi_configured"))
    domain = row.get("tracking_domain_verified")
    aem_events = row.get("tracking_aem_priority_events") or []
    operator_attested = bool(row.get("tracking_verified"))

    aem_count = (
        len(aem_events)
        if isinstance(aem_events, list)
        else (len(aem_events.keys()) if isinstance(aem_events, dict) else 0)
    )

    checks = [
        _check("pixel_id_set", bool(pixel_id), value=pixel_id),
        _check("capi_configured", capi),
        _check("domain_verified", bool(domain), value=domain),
        _check("aem_priority_events", aem_count > 0, count=aem_count),
        _check("operator_attested_verified", operator_attested),
    ]

    passed_count = sum(1 for c in checks if c["passed"])
    total = len(checks)

    # Classification rule:
    # - healthy:    operator_attested=true AND at least pixel+capi+domain present
    # - partial:    operator hasn't attested but ≥2 of the underlying signals are present
    # - unverified: operator hasn't attested AND ≤1 signal — onboarding clearly incomplete
    #
    # We treat operator attestation as the load-bearing signal because that's
    # the gate the operator owns (verify_pixel_capi approval flow flips it).
    # The other four are informational confidence.
    pixel_capi_domain_ok = bool(pixel_id) and capi and bool(domain)
    if operator_attested and pixel_capi_domain_ok:
        status = "healthy"
    elif passed_count >= 2 and not operator_attested:
        status = "partial"
    elif operator_attested and not pixel_capi_domain_ok:
        # Operator claimed verified but underlying state is missing — drift.
        # Treat as partial and surface the contradiction in `recommended_action`.
        status = "partial"
    else:
        status = "unverified"

    blocks = [] if status == "healthy" else BLOCKED_TASKS_WHEN_UNHEALTHY
    recommended = None if status == "healthy" else "verify_pixel_capi"

    emit_success(
        {
            "business_id": args.business_id,
            "status": status,
            "verified": status == "healthy",
            "checks": checks,
            "checks_passed": passed_count,
            "checks_total": total,
            "blocks_proposals": blocks,
            "recommended_action": recommended,
            "note": (
                "MVP — operator-attested state from business_knowledge. "
                "v2 adds live Meta Pixel event-rate + match-quality + last-seen."
            ),
        }
    )


if __name__ == "__main__":
    main()
