"""
Golden-set E1 replay harness.

**Phase 0 (current):** validates the fixtures themselves — schema, internal
consistency, guardrail name existence, deprecated-rule canary. Does NOT yet
invoke `claude -p --dry-run` against each fixture; that lands in Phase 4 per
backend PRD §3.3.

When the agent's dry-run mode exists, add a test parametrized over all
fixtures that feeds `input` to the agent and asserts `expected.decision_class`
+ `expected.tagged_gate` match. The fixtures are already shaped for that.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = Path(__file__).resolve().parents[2] / "campaigner" / "prompts"
GUARDRAILS_FILE = PROMPTS_DIR / "guardrails.md"

VALID_DECISION_CLASSES = {
    "observation",
    "diagnosis",
    "proposal",
    "rejection",
    "skip",
    "execution",
    "error",
}
VALID_TAGGED_GATES = {
    "gate_1_creative",
    "gate_2_campaign",
    "data_sufficiency",
    "guardrail",
    "human_review",
    "canary",
}
VALID_TASK_TYPES = {
    "budget_change",
    "pause_campaign",
    "resume_campaign",
    "pause_adset",
    "new_creative",
    "new_campaign",
    "scale_up",
    "scale_down",
    "expand_audience",
}
VALID_TARGET_KINDS = {"campaign", "adset", "ad", "creative", "account"}
VALID_URGENCIES = {"low", "medium", "high", "urgent"}

# Deprecated phrases that must NOT appear as active runtime rules in prompts.
# These are the §6.7 deprecations. Historical mentions inside "deprecated" /
# "don't do this" / "prohibited" contexts are filtered out (see _is_negated).
# The regexes target active-command phrasings; the negation filter catches
# the rest.
DEPRECATED_ACTIVE_PATTERNS = [
    r"pause\s+on\s+frequency\s*>\s*\d",
    r"kill\s+on\s+frequency\s*>\s*\d",
    r"frequency\s*>\s*3\s*→\s*pause",
    r"keep\s+only\s+top\s+\d+\s+after\s+\d+\s+days",
    r"duplicate\s+winning\s+campaign",
    r"horizontal\s+scaling.*duplication",
]

# Markers that mean "what follows is a deprecated / forbidden thing, not an instruction."
# If any appear in the ~150 chars BEFORE a pattern match, the match is negated.
_NEGATION_MARKERS = (
    "deprecated",
    "don't",
    "do not",
    "never",
    "must not",
    "forbidden",
    "prohibited",
    "not used",
    "no longer",
    "הופקע",
    "אל תציע",
    " אל ",
    "אסור",
    "לא נשתמש",
    "לא trigger",
    "deprecated rules",
    "pre-andromeda",
    "חוקים מופקעים",
    "| deprecated",
    "deprecation",
)


# ----------------------------------------------------------------- fixtures


def _fixture_paths() -> list[Path]:
    return sorted(p for p in FIXTURES_DIR.glob("[0-9][0-9]_*.json") if p.is_file())


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _guardrail_names_from_md() -> set[str]:
    text = GUARDRAILS_FILE.read_text(encoding="utf-8")
    # Each guardrail is declared as a section header `## N. \`rule_name\``.
    return set(re.findall(r"^##\s*\d+\.\s*`([a-z_0-9]+)`", text, flags=re.MULTILINE))


# --------------------------------------------------------- basic integrity


def test_exactly_13_fixtures_present():
    fixtures = _fixture_paths()
    assert len(fixtures) == 13, (
        f"expected 13 fixtures, got {len(fixtures)}: {[p.name for p in fixtures]}"
    )


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_fixture_parses_and_has_required_keys(path: Path):
    data = _load(path)
    for key in ("id", "title", "source", "tagged_gate", "input", "expected", "notes"):
        assert key in data, f"{path.name}: missing top-level key '{key}'"
    assert data["id"] == path.stem, f"{path.name}: id field '{data['id']}' must match filename stem"


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_tagged_gate_is_valid(path: Path):
    data = _load(path)
    assert data["tagged_gate"] in VALID_TAGGED_GATES, (
        f"{path.name}: tagged_gate '{data['tagged_gate']}' not in {VALID_TAGGED_GATES}"
    )


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_expected_decision_class_is_valid(path: Path):
    data = _load(path)
    cls = data["expected"]["decision_class"]
    # canaries use "skip" as the expected class — the "canary" quality is in tagged_gate.
    assert cls in VALID_DECISION_CLASSES, (
        f"{path.name}: decision_class '{cls}' not in {VALID_DECISION_CLASSES}"
    )


# --------------------------------------------------------- proposal integrity


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_proposal_structure_when_class_is_proposal(path: Path):
    data = _load(path)
    exp = data["expected"]
    if exp["decision_class"] != "proposal":
        pytest.skip("decision_class is not 'proposal'")
    prop = exp.get("proposal")
    assert prop is not None, f"{path.name}: class=proposal but proposal is null"
    assert prop["task_type"] in VALID_TASK_TYPES, (
        f"{path.name}: task_type '{prop['task_type']}' not in {VALID_TASK_TYPES}"
    )
    assert prop["target_kind"] in VALID_TARGET_KINDS
    assert prop["urgency"] in VALID_URGENCIES
    assert "rationale_must_contain" in prop and prop["rationale_must_contain"], (
        f"{path.name}: rationale_must_contain must be non-empty — 'what good looks like' can't be empty"
    )


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_rejection_has_guardrail_violations(path: Path):
    data = _load(path)
    exp = data["expected"]
    if exp["decision_class"] != "rejection":
        pytest.skip("decision_class is not 'rejection'")
    violations = exp.get("guardrail_violations") or []
    assert violations, f"{path.name}: class=rejection must list at least one guardrail_violation"


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_skip_has_no_proposal(path: Path):
    data = _load(path)
    exp = data["expected"]
    if exp["decision_class"] != "skip":
        pytest.skip("decision_class is not 'skip'")
    assert exp.get("proposal") is None, f"{path.name}: skip must not carry a proposal"


# ---------------------------------------------------------- cross-references


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_target_id_matches_input(path: Path):
    """If expected.proposal targets a campaign/adset/ad, the id must appear in the input."""
    data = _load(path)
    exp = data["expected"]
    prop = exp.get("proposal")
    if not prop or not prop.get("target_id"):
        pytest.skip("no targeted proposal")
    tid = prop["target_id"]
    kind = prop["target_kind"]
    inp = data["input"]
    present_ids: set[str] = set()
    for section in ("campaign", "ad", "adset"):
        obj = inp.get(section)
        if isinstance(obj, dict) and "id" in obj:
            present_ids.add(obj["id"])
    for a in inp.get("ads", []) or []:
        if isinstance(a, dict) and "id" in a:
            present_ids.add(a["id"])
    assert tid in present_ids, (
        f"{path.name}: proposal.target_id={tid} ({kind}) not found in input "
        f"(present: {sorted(present_ids)})"
    )


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda p: p.stem)
def test_guardrail_names_exist_in_guardrails_md(path: Path):
    data = _load(path)
    known = _guardrail_names_from_md()
    violations = data["expected"].get("guardrail_violations") or []
    for name in violations:
        assert name in known, (
            f"{path.name}: guardrail '{name}' not declared in guardrails.md "
            f"(known: {sorted(known)})"
        )


# ---------------------------------------------------- deprecated-rule canary


@pytest.mark.parametrize(
    "prompt_file",
    sorted(PROMPTS_DIR.glob("*.md")),
    ids=lambda p: p.name,
)
def test_prompts_do_not_contain_active_deprecated_rules(prompt_file: Path):
    """
    Scan every prompt for active-instruction phrasings of rules that §6.7
    declared deprecated. Historical mentions framed as 'deprecated' / 'NOT
    used' / within a 'don't do' table are allowed — the regexes target the
    active-command forms.
    """
    text = prompt_file.read_text(encoding="utf-8").lower()
    hits = []
    for pattern in DEPRECATED_ACTIVE_PATTERNS:
        for m in re.finditer(pattern, text, flags=re.IGNORECASE | re.MULTILINE):
            preceding = text[max(0, m.start() - 150) : m.start()]
            if any(marker in preceding for marker in _NEGATION_MARKERS):
                continue
            # Also skip if the nearest preceding `## ` heading indicates deprecation.
            heading_iter = list(re.finditer(r"^##[^#\n]+", text[: m.start()], flags=re.MULTILINE))
            if heading_iter:
                nearest_heading = heading_iter[-1].group(0)
                if any(marker in nearest_heading for marker in _NEGATION_MARKERS):
                    continue
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            hits.append((pattern, text[start:end]))
    assert not hits, (
        f"{prompt_file.name}: deprecated rule appears as active instruction.\n"
        + "\n".join(f"  pattern={p!r}\n  context={c!r}" for p, c in hits)
    )


def test_canary_fixture_13_is_present_and_tagged():
    """The #13 deprecated-rule canary is load-bearing — verify it exists and is tagged."""
    target = FIXTURES_DIR / "13_deprecated_rule_canary.json"
    assert target.exists(), "fixture 13 (deprecated-rule canary) is missing — DO NOT remove"
    data = _load(target)
    assert data["tagged_gate"] == "canary"
    # Canary asserts the agent emits SKIP, not pause. If this changes, review with caution.
    assert data["expected"]["decision_class"] == "skip"
