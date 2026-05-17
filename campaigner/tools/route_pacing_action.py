"""
tools/route_pacing_action.py — Budget Pacing Router (Mastery v2 Phase B,
2026-05-17).

The "missing brain" between observation and proposal. compute_monthly_pace.py
writes a `budget_health` observation; this tool reads it (plus inputs about
gallery health, active campaigns, and creative fatigue) and returns the
recommended task_type for Flow A to propose.

Before v2, `pace_ratio` only gated `new_creative` when severely under. v2
makes it a *modifier on task_type selection* — the decision tree described
in docs/plans/campaigner-meta-mastery-v2.md §4.1:

    case (status, days_left, has_quality_winner, gallery_health):
      ("underrun", >7, True, healthy):    scale_up(+20%) on best
      ("underrun", >7, True, exhausted):  redeploy_creative from gallery
      ("underrun", >7, True, empty):      alert "צריך תוכן חדש" + Imagen brief
      ("underrun", >7, False, *):         new_campaign OR boost_post if viral
      ("underrun", ≤5, *, *):             lost_opportunity log; no panic-spend
      ("overrun", *, *, *):               scale_down on weakest quality-CPL
      ("ok", *, *, *):                    routine observation

Output is consumed by the agent's prompt: Claude reads `recommended_lane` and
proceeds with the matching §T-lane.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse

from campaigner.tools._contract import (
    emit_success,
    emit_validation_error,
    parse_json_arg,
)


def _route(
    pace: dict,
    gallery_health: str,
    active_campaign_count: int,
    has_quality_winner: bool,
    has_viral_organic: bool,
) -> dict:
    """Pure routing logic. No I/O — easy to test."""
    status = pace.get("status")
    days_left = int(pace.get("days_left", 0))
    int(pace.get("days_elapsed", 0))
    pace_ratio = pace.get("pace")
    monthly_budget = pace.get("monthly_budget_ils") or 0
    spend_so_far = pace.get("spend_this_month") or 0
    effective_budget = pace.get("effective_monthly_budget") or monthly_budget

    # End-of-month brake: never panic-spend.
    if status == "underrun" and days_left <= 5 and (pace_ratio or 0) < 0.85:
        return {
            "recommended_lane": "log_lost_opportunity",
            "rationale_he": (
                f"חודש כמעט נגמר ({days_left} ימים נשארו) ופספסנו את היעד "
                f"החודשי ({(pace_ratio or 0) * 100:.0f}% מהקצב). אל לדחוף "
                f"כעת תקציב כדי 'לסגור' — זה יקפיץ CPL ב-40-100%. במקום, "
                f"רשום lost_opportunity ל-monthly_brief וטפל בסיבת השורש "
                f"לחודש הבא (גלריה? קהל? עונה?)."
            ),
            "blockers": [],
            "next_steps": [
                "log lost_opportunity to monthly_brief",
                "root-cause analysis for next month (creative pool? audience? season?)",
            ],
        }

    if status == "no_budget_set":
        return {
            "recommended_lane": "set_monthly_budget",
            "rationale_he": (
                "אין תקציב חודשי מוגדר. בלי תקציב לא ניתן לנהל הוצאה. "
                "פנה למפעיל להגדיר monthly_budget_ils ב-/business-knowledge."
            ),
            "blockers": ["monthly_budget_ils is null"],
            "next_steps": ["set monthly budget via /business-knowledge"],
        }

    if status == "overrun":
        return {
            "recommended_lane": "scale_down",
            "rationale_he": (
                f"חריגת תקציב — הוצאנו {spend_so_far:.0f} ₪ מתוך "
                f"{effective_budget:.0f} ₪ "
                f"({(pace_ratio or 0) * 100:.0f}% מהקצב). הצע scale_down "
                f"של -15% על הקמפיין החלש ביותר לפי quality-adjusted CPL "
                f"(לא raw CPL — 16.4 lesson)."
            ),
            "blockers": [],
            "next_steps": [
                "rank active campaigns by quality_adjusted_cpl DESC (worst first)",
                "propose scale_down -15% on the worst-performer",
                "if no quality grades exist, surface alert pending grading",
            ],
        }

    if status == "ok":
        return {
            "recommended_lane": "routine_observation",
            "rationale_he": (
                f"בקצב — הוצאנו {spend_so_far:.0f} ₪ מתוך "
                f"{effective_budget:.0f} ₪ "
                f"({(pace_ratio or 0) * 100:.0f}% מהקצב). אין צורך בפעולת "
                f"תקציב; המשך לרצף הרגיל של §T-lanes."
            ),
            "blockers": [],
            "next_steps": ["continue normal §T-lane evaluation"],
        }

    # status == "underrun" with days_left > 5 — pick the right scale lane.
    if active_campaign_count == 0:
        return {
            "recommended_lane": "new_campaign",
            "rationale_he": (
                f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב), "
                f"{days_left} ימים בחודש, ואין קמפיין פעיל. הצע new_campaign "
                f"דרך flow Onboarding אם זה משתמש חדש, או דרך new_campaign "
                f"רגיל אם זה משתמש קיים."
            ),
            "blockers": [],
            "next_steps": ["propose new_campaign with cold-start front-load math"],
        }

    if has_quality_winner:
        if gallery_health == "healthy":
            return {
                "recommended_lane": "scale_up",
                "rationale_he": (
                    f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב). "
                    f"יש קמפיין מנצח (lead quality ≥3.5) וגלריה בריאה. "
                    f"הצע scale_up +20% על המנצח, max 1 step / 72h."
                ),
                "blockers": [],
                "next_steps": [
                    "pick best campaign by quality_adjusted_cpl",
                    "propose scale_up +20% with 72h cooldown",
                ],
            }
        if gallery_health == "exhausted":
            return {
                "recommended_lane": "redeploy_creative",
                "rationale_he": (
                    f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב). "
                    f"יש מנצח אבל הגלריה שלו רוויה (frequency >2.5). "
                    f"לפני scale_up — הצע redeploy_creative מהגלריה הלא-"
                    f"מנוצלת (gallery-first §28)."
                ),
                "blockers": ["winner gallery is saturated"],
                "next_steps": [
                    "query list_active_creatives --unused-in-campaigns --matches-channel",
                    "propose redeploy_creative for the top viable candidate",
                ],
            }
        # gallery_health == "empty"
        return {
            "recommended_lane": "alert_content_bottleneck",
            "rationale_he": (
                f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב). "
                f"יש מנצח, אבל אין יצירתי חדש להזין למודל למידה — הגלריה "
                f"הזמינה ריקה והמנצח מתחיל להתעייף. **לא ניתן להגדיל "
                f"תקציב בלי תוכן חדש**. הצע alert: או 1) ייצור 3 יצירתיים "
                f"חדשים דרך Imagen, או 2) boost_post על פוסט אורגני חזק."
            ),
            "blockers": ["empty gallery + winner needs refresh"],
            "next_steps": [
                "emit alert with 2-option MCQ: imagen vs boost_post candidate",
            ],
        }

    # No winner. Look for organic boost candidate first; else new_campaign.
    if has_viral_organic:
        return {
            "recommended_lane": "boost_post",
            "rationale_he": (
                f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב). "
                f"אין קמפיין מנצח, אבל יש פוסט אורגני שעבר את כל 5 הספים "
                f"(engagement ≥1.5× ממוצע דף, save ≥1%, share ≥0.5%, "
                f"watch ≥25%, ≥3 הודעות תגובה). הצע boost_post כקמפיין "
                f"מקצועי שמשתמש בפוסט הזה כיצירתי."
            ),
            "blockers": [],
            "next_steps": [
                "query check_organic_performance for viral candidates",
                "propose boost_post with object_story_id of the winner",
            ],
        }

    return {
        "recommended_lane": "new_campaign",
        "rationale_he": (
            f"תת-ניצול ({(pace_ratio or 0) * 100:.0f}% מהקצב), אין מנצח "
            f"קיים, ואין פוסט אורגני שעובר את ספי boost_post. הצע "
            f"new_campaign חדש על שירות שעוד לא קיבל קמפיין השנה."
        ),
        "blockers": [],
        "next_steps": [
            "query business_knowledge.products for un-tested services",
            "propose new_campaign with draft_new_campaign_payload",
        ],
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Route pacing observation → recommended task_type lane.",
    )
    p.add_argument(
        "--pace-snapshot",
        required=True,
        help="JSON output of compute_monthly_pace.py (the budget_health row)",
    )
    p.add_argument(
        "--gallery-health",
        choices=["healthy", "exhausted", "empty"],
        required=True,
        help=(
            "Operator/agent classification of gallery availability for the "
            "winning campaign(s). healthy=≥5 viable unused creatives matching "
            "channel; exhausted=winner's gallery is saturated (freq >2.5); "
            "empty=zero usable unused gallery rows."
        ),
    )
    p.add_argument(
        "--active-campaign-count",
        type=int,
        required=True,
        help="Number of currently-active campaigns on this business (from fetch_meta_state).",
    )
    p.add_argument(
        "--has-quality-winner",
        action="store_true",
        help=(
            "True iff there exists an active campaign with avg_quality_14d >= 3.5 "
            "AND graded_sample_size_14d >= 20 (Phase C dependency)."
        ),
    )
    p.add_argument(
        "--has-viral-organic",
        action="store_true",
        help=(
            "True iff check_organic_performance found at least one post past all 5 "
            "boost_post thresholds (Phase E dependency)."
        ),
    )
    args = p.parse_args()

    pace = parse_json_arg(args.pace_snapshot, "pace-snapshot")
    if not isinstance(pace, dict):
        emit_validation_error("--pace-snapshot must be a JSON object")
        return

    decision = _route(
        pace=pace,
        gallery_health=args.gallery_health,
        active_campaign_count=args.active_campaign_count,
        has_quality_winner=args.has_quality_winner,
        has_viral_organic=args.has_viral_organic,
    )

    emit_success(
        {
            "recommended_lane": decision["recommended_lane"],
            "rationale_he": decision["rationale_he"],
            "blockers": decision["blockers"],
            "next_steps": decision["next_steps"],
            "inputs_summary": {
                "pace_status": pace.get("status"),
                "pace_ratio": pace.get("pace"),
                "days_left": pace.get("days_left"),
                "gallery_health": args.gallery_health,
                "active_campaign_count": args.active_campaign_count,
                "has_quality_winner": args.has_quality_winner,
                "has_viral_organic": args.has_viral_organic,
            },
        }
    )


if __name__ == "__main__":
    main()
