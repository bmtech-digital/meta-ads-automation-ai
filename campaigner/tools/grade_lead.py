"""
tools/grade_lead.py — set/update an operator quality grade on a lead.

Phase 2 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§5). Writes one row to `lead_quality_grades`. Multiple grades per lead allowed
(history-preserving); the `lead_latest_grade` view always returns the newest.

Grade scale (1-5):
  1 = ספאם / לא רלוונטי בכלל
  2 = לא איכותי — לא יסגור
  3 = ממוצע — צריך עוד עבודה
  4 = איכותי — סבירות סגירה גבוהה
  5 = איכותי מאוד — כמעט וודאי יסגור / כבר סגר

Used by:
  - Web /leads grading form (POST /api/leads/grade → shells out here)
  - Operator CLI for batch grading from terminal
  - The agent never calls this — only the operator's signal can set quality.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)


def _grade(args: argparse.Namespace) -> dict:
    def _write():
        with get_connection() as conn, conn.cursor() as cur:
            # Verify lead exists for this business — fail loudly otherwise.
            cur.execute(
                "SELECT id, business_id, meta_campaign_id, full_name "
                "FROM leads WHERE id = %s",
                (args.lead_id,),
            )
            lead = cur.fetchone()
            if not lead:
                return {"error": "lead_not_found", "lead_id": args.lead_id}
            if str(lead["business_id"]) != args.business_id:
                return {
                    "error": "lead_business_mismatch",
                    "lead_id": args.lead_id,
                    "expected_business": args.business_id,
                    "actual_business": str(lead["business_id"]),
                }

            cur.execute(
                """
                INSERT INTO lead_quality_grades (
                    lead_id, business_id, grade, note,
                    converted, converted_value_ils, conversion_marked_at,
                    graded_by, graded_at
                )
                VALUES (
                    %(lead_id)s, %(business_id)s, %(grade)s, %(note)s,
                    %(converted)s::boolean, %(converted_value)s::numeric,
                    CASE WHEN %(converted)s::boolean IS NOT NULL THEN now() ELSE NULL END,
                    %(graded_by)s, now()
                )
                RETURNING id::text, graded_at::text
                """,
                {
                    "lead_id": args.lead_id,
                    "business_id": args.business_id,
                    "grade": args.grade,
                    "note": args.note,
                    "converted": args.converted,
                    "converted_value": args.converted_value_ils,
                    "graded_by": args.graded_by,
                },
            )
            row = cur.fetchone()
            return {
                "ok": True,
                "lead_id": args.lead_id,
                "lead_name": lead.get("full_name"),
                "meta_campaign_id": lead.get("meta_campaign_id"),
                "grade_id": row["id"] if row else None,
                "graded_at": row["graded_at"] if row else None,
                "grade": args.grade,
            }

    return with_db_retry(_write)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Record an operator quality grade on a lead."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--lead-id", required=True, help="local leads.id (uuid), NOT the Meta lead_id"
    )
    p.add_argument(
        "--grade",
        type=int,
        required=True,
        choices=[1, 2, 3, 4, 5],
        help="1=spam, 5=excellent (see docstring)",
    )
    p.add_argument("--note", default=None, help="Optional Hebrew rationale.")
    p.add_argument(
        "--converted",
        choices=["true", "false"],
        default=None,
        help="Mark whether this lead converted to a paying customer.",
    )
    p.add_argument(
        "--converted-value-ils",
        type=float,
        default=None,
        help="Deal value if converted (for revenue-aware quality math later).",
    )
    p.add_argument(
        "--graded-by",
        default=None,
        help="Operator email/handle for audit.",
    )
    args = p.parse_args()

    if args.converted is not None:
        args.converted = args.converted == "true"

    try:
        result = _grade(args)
    except Exception as e:
        emit_runtime_error(f"grade write failed: {e}", e)
        return

    if result.get("error"):
        emit_validation_error(
            result["error"], {k: v for k, v in result.items() if k != "error"}
        )
        return

    emit_success(result)


if __name__ == "__main__":
    main()
