"""
tools/propose_audience.py — typed wrapper for audience-creation approvals.

Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§4.2). Three task_types: `create_custom_audience`, `create_saved_audience`,
`create_lookalike`. Validates the audience-specific shape locally before
inserting into `approvals`, so the operator gets a clear error message
instead of a guardrail rejection at execute time.

Per-task validation:

* `create_custom_audience` — `--subtype` must be one of the Phase-1 allowed
  non-PII subtypes (WEBSITE / ENGAGEMENT / VIDEO / LEAD_GENERATION).
  CUSTOM (customer-file PII) is deferred to Phase 2.
* `create_lookalike` — `--origin-audience-id` must already exist in
  `meta_audiences` (caller must run `sync_audiences` first), and the seed's
  `approximate_count_upper_bound` must be ≥ 100 (Meta's hard minimum).
  Guardrail §35 re-checks this at approve time as defense-in-depth.
* `create_saved_audience` — `--targeting-spec` JSON must be a non-empty dict
  with at least one of `geo_locations` / `flexible_spec` / `interests`.

Output: same `{approval_id, task_type, status, ...}` shape as
`propose_task.py` so the agent can reuse the same downstream handling.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one, get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)


def _validate_service_tag(business_id: str, service_tag: str) -> None:
    """Confirm service_tag matches an entry in business_knowledge.products.

    Phase 1 enforcement of the service↔audience link: a service_tag that
    doesn't correspond to a real product means the agent picked a string
    out of thin air — block at propose time so the operator never sees a
    proposal tied to a service they don't have.
    """
    row = fetch_one(
        "SELECT products FROM business_knowledge WHERE business_id = %s",
        (business_id,),
    )
    if not row:
        emit_validation_error(
            f"--service-tag '{service_tag}' given but business_knowledge row "
            "is missing — fill /business-knowledge first."
        )
    products = row.get("products") or []
    if not isinstance(products, list):
        emit_validation_error(
            "business_knowledge.products is malformed — cannot validate --service-tag."
        )
    norm = service_tag.strip().lower()
    if not any(
        isinstance(p, dict)
        and isinstance(p.get("name"), str)
        and p["name"].strip().lower() == norm
        for p in products
    ):
        emit_validation_error(
            f"--service-tag '{service_tag}' not found among business_knowledge.products "
            "names. Add the service under 'השירותים שלי' first, or fix the spelling."
        )


# Mirrors execute_task._ALLOWED_CUSTOM_SUBTYPES_PHASE1 — keep in sync.
ALLOWED_CUSTOM_SUBTYPES_PHASE1 = ("WEBSITE", "ENGAGEMENT", "VIDEO", "LEAD_GENERATION")
LOOKALIKE_TYPES = ("similarity", "reach")
VALID_URGENCIES = ("low", "medium", "high", "urgent")


def _validate_custom_audience(args: argparse.Namespace) -> dict:
    """Build the payload for a `create_custom_audience` proposal."""
    if not args.subtype:
        emit_validation_error("create_custom_audience requires --subtype")
    if args.subtype not in ALLOWED_CUSTOM_SUBTYPES_PHASE1:
        emit_validation_error(
            f"--subtype '{args.subtype}' not allowed in Phase 1 "
            f"(allowed: {list(ALLOWED_CUSTOM_SUBTYPES_PHASE1)}). "
            "CUSTOM (customer-file PII) is deferred to Phase 2."
        )
    if args.retention_days < 1 or args.retention_days > 180:
        emit_validation_error(
            f"--retention-days must be in [1, 180] (got {args.retention_days})"
        )

    rule = parse_json_arg(args.rule, "rule")
    if rule is not None and not isinstance(rule, dict):
        emit_validation_error("--rule must be a JSON object")
    if args.subtype == "WEBSITE" and not rule:
        emit_validation_error(
            "WEBSITE custom audiences require --rule (Meta inclusions/exclusions spec)"
        )

    payload: dict = {
        "name": args.name,
        "subtype": args.subtype,
        "retention_days": args.retention_days,
        "intended_use": args.intended_use,
    }
    if args.description:
        payload["description"] = args.description
    if rule is not None:
        payload["rule"] = rule
    if args.pixel_id:
        payload["pixel_id"] = args.pixel_id
    return payload


def _validate_saved_audience(args: argparse.Namespace) -> dict:
    """Build the payload for a `create_saved_audience` proposal.

    Note: Meta Marketing API does not expose saved-audience creation; the
    operator creates it manually in Ads Manager and the next `sync_audiences`
    run picks it up. The agent's value here is the targeting spec + Hebrew
    rationale.
    """
    targeting = parse_json_arg(args.targeting_spec, "targeting-spec")
    if not isinstance(targeting, dict) or not targeting:
        emit_validation_error("--targeting-spec must be a non-empty JSON object")
    has_geo = bool(targeting.get("geo_locations"))
    has_demo = bool(targeting.get("flexible_spec") or targeting.get("interests"))
    if not (has_geo or has_demo):
        emit_validation_error(
            "--targeting-spec must include at least one of "
            "geo_locations / flexible_spec / interests"
        )
    payload: dict = {
        "name": args.name,
        "targeting_spec": targeting,
        "intended_use": args.intended_use,
    }
    if args.description:
        payload["description"] = args.description
    return payload


def _validate_lookalike(args: argparse.Namespace, business_id: str) -> dict:
    """Build the payload for a `create_lookalike` proposal.

    Pre-checks the seed audience: it must exist in `meta_audiences` and its
    `approximate_count_upper_bound` must be ≥ 100. Guardrail §35 re-runs the
    same check at approve time, but failing here means the agent gets a
    clear validation error in its tool output instead of a soft guardrail
    rejection later.
    """
    if not args.origin_audience_id:
        emit_validation_error(
            "create_lookalike requires --origin-audience-id (the seed's Meta ID)"
        )
    if not (0.01 <= args.ratio <= 0.10):
        emit_validation_error(
            f"--ratio must be in [0.01, 0.10] (got {args.ratio})"
        )
    if args.country and len(args.country) != 2:
        emit_validation_error(
            f"--country must be a 2-letter ISO code (got {args.country!r})"
        )
    if args.type and args.type not in LOOKALIKE_TYPES:
        emit_validation_error(
            f"--type must be one of {list(LOOKALIKE_TYPES)} (got {args.type!r})"
        )

    seed = fetch_one(
        "SELECT name, approximate_count_upper_bound AS up "
        "FROM meta_audiences "
        "WHERE business_id = %s AND meta_audience_id = %s "
        "AND archived_at IS NULL",
        (business_id, str(args.origin_audience_id)),
    )
    if not seed:
        emit_validation_error(
            f"seed audience {args.origin_audience_id} not found in meta_audiences "
            "— run `sync_audiences` first."
        )
    seed_upper = seed.get("up") or 0
    if seed_upper < 100:
        emit_validation_error(
            f"seed '{seed.get('name')}' upper-bound count {seed_upper} < 100 "
            "(Meta requires ≥ 100 for Lookalike). Pick a larger seed or wait for it to grow."
        )

    payload: dict = {
        "name": args.name,
        "origin_audience_id": str(args.origin_audience_id),
        "country": (args.country or "IL").upper(),
        "ratio": args.ratio,
        "intended_use": args.intended_use,
    }
    if args.type:
        payload["type"] = args.type
    return payload


def _insert_approval(
    *,
    business_id: str,
    run_id: str,
    task_type: str,
    payload: dict,
    rationale: str,
    urgency: str,
    expires_at: datetime,
    scheduled_for: datetime | None,
) -> dict:
    def _do_insert() -> dict:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO approvals (
                    business_id, created_by_run_id, task_type,
                    target_kind, target_id,
                    payload, rationale, expected_impact,
                    urgency, expires_at, scheduled_for
                )
                VALUES (
                    %s, %s, %s,
                    %s, %s,
                    %s::jsonb, %s, %s::jsonb,
                    %s, %s, %s
                )
                RETURNING id, status, created_at, expires_at, scheduled_for
                """,
                (
                    business_id,
                    run_id,
                    task_type,
                    None,  # audience proposals don't reference a Meta target object yet
                    None,
                    json.dumps(payload),
                    rationale,
                    None,
                    urgency,
                    expires_at,
                    scheduled_for,
                ),
            )
            return cur.fetchone()

    return with_db_retry(_do_insert)


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Propose an audience-creation approval. Typed wrapper around "
            "`propose_task` for the three Phase-1 audience task_types."
        )
    )
    p.add_argument("--business-id", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument(
        "--task-type",
        required=True,
        choices=("create_custom_audience", "create_saved_audience", "create_lookalike"),
    )
    p.add_argument("--name", required=True, help="Audience name (Hebrew-friendly).")
    p.add_argument(
        "--service-tag",
        default=None,
        help=(
            "Block 13 (2026-05-13): the business_knowledge.products[].name this "
            "audience is for. Required when invoked from Flow E (per-service "
            "audience proposals). Optional in other flows. Validated against "
            "products list at propose time."
        ),
    )
    p.add_argument(
        "--intended-use",
        required=True,
        help="Hebrew, plain language: which campaign / segment will consume this audience.",
    )
    p.add_argument(
        "--rationale",
        required=True,
        help="Hebrew, why this audience now. Read by the operator on the approval card.",
    )
    p.add_argument("--description", default=None)

    # create_custom_audience
    p.add_argument(
        "--subtype",
        choices=ALLOWED_CUSTOM_SUBTYPES_PHASE1,
        help="Required for create_custom_audience. Phase-1 non-PII subtypes only.",
    )
    p.add_argument("--retention-days", type=int, default=180)
    p.add_argument("--rule", help="WEBSITE rule as JSON (Meta inclusions/exclusions spec).")
    p.add_argument(
        "--pixel-id", help="Optional pixel override for WEBSITE audiences."
    )

    # create_saved_audience
    p.add_argument(
        "--targeting-spec",
        help="Required for create_saved_audience. Meta targeting spec as JSON.",
    )

    # create_lookalike
    p.add_argument("--origin-audience-id", help="Required for create_lookalike — seed's Meta ID.")
    p.add_argument("--country", default="IL", help="2-letter ISO code (default IL).")
    p.add_argument(
        "--ratio",
        type=float,
        default=0.01,
        help="Lookalike size: 0.01 to 0.10 (1%% to 10%%; default 0.01).",
    )
    p.add_argument("--type", choices=LOOKALIKE_TYPES, help="Lookalike type (default: Meta default).")

    # Approval-row metadata (passthrough to propose_task semantics)
    p.add_argument("--urgency", choices=VALID_URGENCIES, default="medium")
    p.add_argument(
        "--expires-in-hours",
        type=float,
        default=48.0,
        help="Pending TTL before auto-expire (default 48h).",
    )
    p.add_argument(
        "--scheduled-for",
        default=None,
        help="ISO-8601 with TZ — defer execution until this time. Omit to fire on approve.",
    )

    args = p.parse_args()

    # Common arg validation
    if args.expires_in_hours <= 0 or args.expires_in_hours > 24 * 30:
        emit_validation_error(
            f"--expires-in-hours must be in (0, 720] (got {args.expires_in_hours})"
        )
    if not args.intended_use.strip():
        emit_validation_error("--intended-use must not be empty")
    if not args.rationale.strip():
        emit_validation_error("--rationale must not be empty")

    scheduled_for_dt: datetime | None = None
    if args.scheduled_for:
        try:
            scheduled_for_dt = datetime.fromisoformat(
                args.scheduled_for.replace("Z", "+00:00")
            )
        except ValueError as e:
            emit_validation_error(
                f"--scheduled-for must be ISO-8601 with TZ (got {args.scheduled_for!r}): {e}"
            )
            return
        if scheduled_for_dt.tzinfo is None:
            emit_validation_error(
                "--scheduled-for must include a timezone offset (no naive datetimes)"
            )
            return

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Per-task-type validation builds the payload.
    if args.task_type == "create_custom_audience":
        payload = _validate_custom_audience(args)
    elif args.task_type == "create_saved_audience":
        payload = _validate_saved_audience(args)
    else:  # create_lookalike
        payload = _validate_lookalike(args, args.business_id)

    # Block 13 (2026-05-13): tag the proposal with the source service. The
    # column on meta_audiences is populated by execute_task after Meta
    # successfully creates the audience.
    if args.service_tag:
        service_tag = args.service_tag.strip()
        if not service_tag:
            emit_validation_error("--service-tag must not be empty/whitespace")
            return
        _validate_service_tag(args.business_id, service_tag)
        payload["service_tag"] = service_tag

    expires_at = datetime.now(UTC) + timedelta(hours=args.expires_in_hours)

    try:
        row = _insert_approval(
            business_id=args.business_id,
            run_id=args.run_id,
            task_type=args.task_type,
            payload=payload,
            rationale=args.rationale,
            urgency=args.urgency,
            expires_at=expires_at,
            scheduled_for=scheduled_for_dt,
        )
    except Exception as e:
        emit_runtime_error(f"approvals insert failed: {e}", exc=e)
        return

    emit_success(
        {
            "approval_id": str(row["id"]),
            "business_id": args.business_id,
            "task_type": args.task_type,
            "name": payload["name"],
            "status": row["status"],
            "urgency": args.urgency,
            "created_at": row["created_at"].isoformat(),
            "expires_at": row["expires_at"].isoformat(),
            "scheduled_for": row["scheduled_for"].isoformat() if row["scheduled_for"] else None,
        }
    )


if __name__ == "__main__":
    main()
