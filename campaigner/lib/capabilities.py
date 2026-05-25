"""
lib/capabilities.py — deterministic premise check for the agent's runnable
actions on a given run.

Background (from `docs/todos/capability-gated-decision-flow.md`):

The agent has ~45 gates split into two groups. Category A gates ("don't take
*this* action") are working correctly and stay where they are. Category B
gates ("don't *speak* because some prior input is missing") were being
enforced inside the LLM prompt — which had two failure modes:

  1. When a gate fired, the LLM emitted a `skip` decision (or no row at all)
     and the operator never saw the diagnosis the agent did under the hood.
  2. The LLM had to re-derive "can I even act?" from raw state on every run,
     and got it wrong (e.g. silencing an `objective_mismatch` because a
     *scale-spend* gate was blocking — wrong premise).

This module moves Category B out of the LLM. A pure function reads the
already-gathered business state and returns the list of capabilities the
agent is permitted to *act* on this run. The agent still emits the
diagnoses regardless — for capabilities that are blocked, it emits
`observation_blocked` (the operator sees "ready when you unblock me") instead
of `proposal` (which would have been rejected at guardrail time anyway).

Requirements are intentionally a port of the existing scattered gates — see
`docs/todos/capability-gated-decision-flow.md` §Reference. **Do not add new
requirements here without first removing the corresponding LLM-prompt check.**

Pure function: no I/O, no LLM, no Meta. Callable from a CLI tool that
prints the result to stdout, and from tests that pass synthetic state.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


# ---- Public types -----------------------------------------------------------


@dataclass(frozen=True)
class Capability:
    """A single agent capability + whether it is exercisable this run.

    `blocked_by` lists the requirement *names* (stable identifiers) that
    failed. The UI surfaces them; the agent quotes them in `observation_blocked`
    rows so the operator can correlate "what would unblock this."
    """

    name: str
    available: bool
    blocked_by: list[str] = field(default_factory=list)
    reason_he: str = ""


@dataclass
class CapabilityReport:
    capabilities: list[Capability]
    blocked_count: int
    available_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "capabilities": [asdict(c) for c in self.capabilities],
            "blocked_count": self.blocked_count,
            "available_count": self.available_count,
        }

    def get(self, name: str) -> Capability | None:
        for c in self.capabilities:
            if c.name == name:
                return c
        return None


# ---- Requirement predicates -------------------------------------------------
#
# Each predicate is `(state: dict) -> bool`. They read from a single shared
# `business_state` dict shaped like:
#
#   {
#     "tracking_health":   {<output of check_tracking_health.py>},
#     "account_health":    {<output of check_account_health.py>},
#     "business":          {<row from businesses>},
#     "business_knowledge":{<row from business_knowledge>},
#     "kpi_research":      {<latest set_kpi_target research, or None>},
#     "campaign_state":    {  # OPTIONAL, per-capability scope
#         "utilization_7d":         float | None,
#         "in_learning":            bool,
#         "ab_test_age_days":       int | None,
#         "cpa_vs_target_ratio":    float | None,
#         "viable_unused_count":    int | None,
#     },
#   }
#
# The top-level keys are all optional. A missing key is treated as "data not
# available" → the predicate fails closed (returns False). That keeps the
# blocking direction safe by default.


def _tracking_verified(state: dict[str, Any]) -> bool:
    th = state.get("tracking_health") or {}
    # `status='healthy'` is the canonical pass. The risk-override path
    # (operator opted out of the tracking-block safeguard) also clears
    # `blocks_proposals` — when blocks_proposals is empty AND we have any
    # tracking_health row, the capability is exercisable.
    if th.get("status") == "healthy":
        return True
    if th.get("risk_override_active") is True and not th.get("blocks_proposals"):
        return True
    return False


def _primary_kpi_set(state: dict[str, Any]) -> bool:
    biz = state.get("business") or {}
    return bool(biz.get("primary_kpi"))


def _target_value_set(state: dict[str, Any]) -> bool:
    biz = state.get("business") or {}
    kpi = (biz.get("primary_kpi") or "").lower()
    if not kpi:
        return False
    field_name = {
        "cpa": "target_cpa_ils",
        "cpl": "target_cpl_ils",
        "roas": "target_roas",
    }.get(kpi)
    if not field_name:
        # cpm / cpi / unknown — no target column; gate doesn't apply, treat as set.
        return True
    return biz.get(field_name) is not None


def _not_in_learning(state: dict[str, Any]) -> bool:
    cs = state.get("campaign_state") or {}
    # Default to "not in learning" when state is unknown — this is the
    # *capability* gate; the per-campaign learning check still runs at
    # action time. Missing per-campaign state shouldn't block the whole
    # capability for the run.
    return not bool(cs.get("in_learning", False))


def _utilization_7d_at_least_50(state: dict[str, Any]) -> bool:
    cs = state.get("campaign_state") or {}
    util = cs.get("utilization_7d")
    if util is None:
        # Unknown utilization at capability time → don't block the whole
        # capability; §T-1 still runs per-campaign. Pass the predicate so
        # the agent can route based on actual data.
        return True
    return float(util) >= 0.5


def _cpa_above_target(state: dict[str, Any]) -> bool:
    cs = state.get("campaign_state") or {}
    ratio = cs.get("cpa_vs_target_ratio")
    if ratio is None:
        # Unknown → pass; per-campaign §T_AE check still runs.
        return True
    return float(ratio) > 1.0


def _research_sources_at_least_2(state: dict[str, Any]) -> bool:
    research = state.get("kpi_research") or {}
    srcs = research.get("sources") or []
    return isinstance(srcs, list) and len(srcs) >= 2


def _matched_terms_present(state: dict[str, Any]) -> bool:
    research = state.get("kpi_research") or {}
    terms = research.get("matched_terms") or []
    return isinstance(terms, list) and len(terms) >= 1


def _test_age_at_least_7d(state: dict[str, Any]) -> bool:
    cs = state.get("campaign_state") or {}
    age = cs.get("ab_test_age_days")
    if age is None:
        # No A/B test in scope → there's nothing to decide. Treat the
        # capability as unavailable for THIS run via blocked_by, not as
        # silently OK.
        return False
    return int(age) >= 7


# Requirement name → predicate. The name strings are stable identifiers
# the LLM quotes in `outputs.blocked_by`.
_REQUIREMENTS: dict[str, tuple[callable, str]] = {
    "tracking_verified": (_tracking_verified, "אימות מעקב (פיקסל/CAPI) חסר"),
    "primary_kpi_set": (_primary_kpi_set, "לא הוגדר KPI ראשי"),
    "target_value_set": (_target_value_set, "לא הוגדר ערך יעד ל-KPI"),
    "not_in_learning": (_not_in_learning, "הקמפיין בשלב למידה"),
    "utilization_7d_at_least_50": (
        _utilization_7d_at_least_50,
        "ניצול תקציב 7 ימים מתחת ל-50%",
    ),
    "cpa_above_target": (_cpa_above_target, "ה-CPA לא חורג מהיעד"),
    "research_sources_at_least_2": (
        _research_sources_at_least_2,
        "צריך לפחות שני מקורות מחקר",
    ),
    "matched_terms_present": (
        _matched_terms_present,
        "המחקר לא מצא מונחים תואמים לעסק",
    ),
    "test_age_at_least_7d": (_test_age_at_least_7d, "מבחן A/B צעיר מ-7 ימים"),
}


# ---- Capability catalog -----------------------------------------------------
#
# Mirrors the table in docs/todos/capability-gated-decision-flow.md. The
# Hebrew `reason_he` on the Capability is filled in dynamically from the
# blocked requirements; the per-capability description below is the static
# Hebrew label rendered when the capability is available.


_CAPABILITIES: list[tuple[str, list[str], str]] = [
    # (capability_name, list of required predicate names, available_reason_he)
    ("emergency_pause", [], "השהיה דחופה זמינה"),
    ("objective_mismatch_alert", [], "ניתן להציף התראת אי-התאמת מטרה"),
    ("creative_fatigue_alert", [], "ניתן להציף התראת עייפות קריאייטיב"),
    ("pool_misalignment_alert", [], "ניתן להציף התראת אי-התאמת מאגר"),
    ("set_monthly_budget_alert", [], "ניתן להציף בקשה להגדרת תקציב חודשי"),
    (
        "set_kpi_target",
        ["research_sources_at_least_2", "matched_terms_present"],
        "ניתן להציע יעד KPI",
    ),
    (
        "scale_up",
        [
            "tracking_verified",
            "primary_kpi_set",
            "target_value_set",
            "not_in_learning",
        ],
        "ניתן להציע הגדלת תקציב",
    ),
    (
        "scale_down",
        ["tracking_verified", "primary_kpi_set"],
        "ניתן להציע הקטנת תקציב",
    ),
    (
        "new_creative",
        ["tracking_verified", "utilization_7d_at_least_50"],
        "ניתן להציע קריאייטיב חדש",
    ),
    (
        "new_campaign",
        ["tracking_verified", "primary_kpi_set", "target_value_set"],
        "ניתן להציע קמפיין חדש",
    ),
    (
        "expand_audience",
        ["tracking_verified", "cpa_above_target"],
        "ניתן להציע הרחבת קהל",
    ),
    ("redeploy_creative", ["tracking_verified"], "ניתן להציע פריסה מחדש של קריאייטיב"),
    ("ab_test_decide", ["test_age_at_least_7d"], "ניתן להכריע מבחן A/B"),
]


def compute_capabilities(business_state: dict[str, Any]) -> CapabilityReport:
    """Return the CapabilityReport for the given business state.

    Pure. Same input → same output. No I/O.
    """
    if business_state is None:
        business_state = {}

    capabilities: list[Capability] = []
    for cap_name, requirements, available_reason in _CAPABILITIES:
        blocked_by: list[str] = []
        block_reasons_he: list[str] = []
        for req_name in requirements:
            pred, reason_he = _REQUIREMENTS[req_name]
            if not pred(business_state):
                blocked_by.append(req_name)
                block_reasons_he.append(reason_he)

        available = not blocked_by
        reason_he = available_reason if available else " · ".join(block_reasons_he)
        capabilities.append(
            Capability(
                name=cap_name,
                available=available,
                blocked_by=blocked_by,
                reason_he=reason_he,
            )
        )

    blocked = sum(1 for c in capabilities if not c.available)
    return CapabilityReport(
        capabilities=capabilities,
        blocked_count=blocked,
        available_count=len(capabilities) - blocked,
    )


__all__ = ["Capability", "CapabilityReport", "compute_capabilities"]
