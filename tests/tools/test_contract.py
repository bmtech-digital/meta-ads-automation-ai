"""
Contract-compliance tests for campaigner/tools/*.

What we verify (per spec §11.6):
  1. Valid args → exit 0 + stdout is a parseable JSON object.
  2. Missing required arg → exit 2 (argparse error) + stderr non-empty.
  3. Invalid enum value → exit 2 (argparse 'choices' rejection).
  4. Invalid JSON in a JSON arg → exit 2 (our validation layer).

Business semantics (does the row actually land in the right table with the
right values) is covered separately in `test_log_decision.py` and
`test_propose_task.py`. These tests only care about the CLI contract.
"""

from __future__ import annotations

import json

import pytest

# ---------- fixtures ----------


@pytest.fixture
def base_log_args(business_id, run_id):
    return [
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--graph-name",
        "observe_propose",
        "--node-name",
        "observe",
        "--decision-type",
        "observation",
        "--summary",
        "contract test",
    ]


@pytest.fixture
def base_propose_args(business_id, run_id):
    return [
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "budget_change",
        "--payload",
        '{"new_daily_budget_cents":6500}',
        "--rationale",
        "contract test",
    ]


# ---------- exit 0: valid args ----------


def test_load_baselines_valid_args_exits_0(invoke_tool, business_id):
    r = invoke_tool("load_baselines", "--business-id", business_id)
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["business_id"] == business_id
    assert "baselines" in payload
    assert isinstance(payload["baselines"], list)


def test_log_decision_valid_args_exits_0(invoke_tool, cleanup_run, base_log_args):
    r = invoke_tool("log_decision", *base_log_args)
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert "id" in payload
    assert payload["decision_type"] == "observation"


def test_propose_task_valid_args_exits_0(invoke_tool, cleanup_run, business_id, base_propose_args):
    # cleanup_run fixture already ensures DB state is clean — just use its run_id
    args = [a if a != base_propose_args[3] else cleanup_run for a in base_propose_args]
    # Replace run-id (arg index 3) with the cleanup_run value
    args = list(base_propose_args)
    args[3] = cleanup_run
    r = invoke_tool("propose_task", *args)
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert "approval_id" in payload
    assert payload["status"] == "pending"
    assert payload["task_type"] == "budget_change"


# fetch_insights is NOT exercised end-to-end here — it hits the live Meta API.
# We only verify it rejects bad args (covered below).


# ---------- exit 2: missing required arg ----------


@pytest.mark.parametrize(
    "tool",
    [
        "fetch_insights",
        "load_baselines",
        "log_decision",
        "propose_task",
        "fetch_meta_state",
        "check_marginal_return",
        "check_creative_fatigue",
        "check_tracking_health",
        "check_organic_performance",
        "estimate_cpl",
        "list_ab_tests",
        "evaluate_ab_test",
        "sync_audiences",
        "list_audiences",
        "propose_audience",
        # Phase 2-7 additions (Campaigner Mastery Plan):
        "sync_leads",
        "grade_lead",
        "fetch_lead_quality_summary",
        "compute_quality_adjusted_kpi",
        "backfill_gallery_from_meta",
        "check_business_alignment",
        "check_account_health",
    ],
)
def test_missing_business_id_exits_2(invoke_tool, tool):
    r = invoke_tool(tool)  # no args at all
    assert r.returncode == 2, f"tool={tool} stdout={r.stdout} stderr={r.stderr}"
    assert r.stderr, "argparse errors must go to stderr"


def test_fetch_meta_state_invalid_object_type_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "fetch_meta_state",
        "--business-id",
        business_id,
        "--object-type",
        "bogus",
        "--object-id",
        "123",
    )
    assert r.returncode == 2


def test_check_marginal_return_invalid_lookback_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "check_marginal_return",
        "--business-id",
        business_id,
        "--campaign-id",
        "123",
        "--lookback-days",
        "0",
    )
    assert r.returncode == 2


def test_check_creative_fatigue_invalid_days_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "check_creative_fatigue",
        "--business-id",
        business_id,
        "--days",
        "31",
    )
    assert r.returncode == 2


def test_check_organic_performance_invalid_days_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "check_organic_performance",
        "--business-id",
        business_id,
        "--days",
        "0",
    )
    assert r.returncode == 2


def test_check_organic_performance_invalid_baseline_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "check_organic_performance",
        "--business-id",
        business_id,
        "--baseline-engagement-rate",
        "1.5",
    )
    assert r.returncode == 2


def test_log_decision_missing_decision_type_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "log_decision",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--graph-name",
        "observe_propose",
        "--node-name",
        "observe",
        "--summary",
        "x",
        # --decision-type omitted
    )
    assert r.returncode == 2


def test_propose_task_missing_payload_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "budget_change",
        "--rationale",
        "x",
        # --payload omitted
    )
    assert r.returncode == 2


# ---------- exit 2: invalid enum ----------


def test_fetch_insights_invalid_level_exits_2(invoke_tool, business_id):
    r = invoke_tool("fetch_insights", "--business-id", business_id, "--level", "bogus")
    assert r.returncode == 2


def test_log_decision_invalid_decision_type_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "log_decision",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--graph-name",
        "observe_propose",
        "--node-name",
        "observe",
        "--decision-type",
        "bogus",
        "--summary",
        "x",
    )
    assert r.returncode == 2


def test_log_decision_observation_blocked_accepted(invoke_tool, cleanup_run, business_id):
    """Migration 033 — observation_blocked is a valid decision_type.

    The CHECK constraint added in the migration is the gate; argparse + the
    VALID_DECISION_TYPES tuple in log_decision.py guard the entrypoint."""
    r = invoke_tool(
        "log_decision",
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--graph-name",
        "observe_propose",
        "--node-name",
        "diagnose",
        "--decision-type",
        "observation_blocked",
        "--summary",
        "objective_mismatch found on AI agent campaign — blocked by tracking_verified",
        "--outputs",
        json.dumps(
            {
                "finding_type": "objective_mismatch",
                "blocked_by": ["tracking_verified"],
                "would_propose": {"task_type": "alert", "payload": {}},
                "summary_he": "אי-התאמת מטרה",
            }
        ),
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["decision_type"] == "observation_blocked"


def test_propose_task_invalid_task_type_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "bogus",
        "--payload",
        "{}",
        "--rationale",
        "x",
    )
    assert r.returncode == 2


def test_propose_task_finding_key_dedups_second_insert(
    invoke_tool, cleanup_run, business_id
):
    """Migration 033 — when a pending approval already carries the same
    finding_key, the second propose_task call returns the existing approval
    id and skipped=true instead of inserting a duplicate row.
    """
    fk = f"contract-test-finding:{cleanup_run}"
    common = [
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "alert",
        "--payload",
        '{"alert_type":"contract","message":"x","acknowledgment_only":true}',
        "--rationale",
        "contract test for finding_key dedup",
        "--finding-key",
        fk,
    ]
    r1 = invoke_tool("propose_task", *common)
    assert r1.returncode == 0, f"stderr: {r1.stderr}"
    p1 = json.loads(r1.stdout)
    assert p1.get("skipped") is False
    first_id = p1["approval_id"]

    r2 = invoke_tool("propose_task", *common)
    assert r2.returncode == 0, f"stderr: {r2.stderr}"
    p2 = json.loads(r2.stdout)
    assert p2.get("skipped") is True
    assert p2.get("dedup_reason") == "existing_finding_key"
    assert p2["approval_id"] == first_id


def test_propose_task_distinct_finding_keys_coexist(
    invoke_tool, cleanup_run, business_id
):
    """Two findings of different types on the same business must NOT dedup
    against each other. Validates the structural dedup primitive — previously
    the agent's vibe-based dedup collapsed unrelated findings into one row."""
    common_args = [
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "alert",
        "--payload",
        '{"alert_type":"contract","message":"x","acknowledgment_only":true}',
        "--rationale",
        "contract test for distinct finding_keys",
    ]
    fk_a = f"finding-a:{cleanup_run}"
    fk_b = f"finding-b:{cleanup_run}"
    ra = invoke_tool("propose_task", *common_args, "--finding-key", fk_a)
    rb = invoke_tool("propose_task", *common_args, "--finding-key", fk_b)
    assert ra.returncode == 0 and rb.returncode == 0
    pa = json.loads(ra.stdout)
    pb = json.loads(rb.stdout)
    assert pa["approval_id"] != pb["approval_id"]
    assert pa.get("skipped") is False
    assert pb.get("skipped") is False


# Block 11 (2026-05-13): ab_test_setup + ab_test_decide are valid task_types.
def test_propose_task_ab_test_setup_accepted(invoke_tool, cleanup_run, business_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "ab_test_setup",
        "--payload",
        '{"test_name":"contract-test","campaign_id":"c1","adset_id":"a1",'
        '"winner_metric":"ctr","window_days":7,'
        '"creatives":[{"creative_id":"x","variant_label":"A"},'
        '{"creative_id":"y","variant_label":"B"}]}',
        "--rationale",
        "contract test for ab_test_setup",
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["task_type"] == "ab_test_setup"


def test_propose_task_ab_test_decide_accepted(invoke_tool, cleanup_run, business_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "ab_test_decide",
        "--payload",
        '{"ab_test_id":"00000000-0000-0000-0000-000000000000","cancel_instead":true}',
        "--rationale",
        "contract test for ab_test_decide (cancel)",
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["task_type"] == "ab_test_decide"


# Block 8 (2026-05-13): redeploy_creative is a valid task_type. argparse
# should accept it; payload validation happens downstream in execute_task.
def test_propose_task_redeploy_creative_accepted(invoke_tool, cleanup_run, business_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "redeploy_creative",
        "--payload",
        '{"creative_gallery_id":"00000000-0000-0000-0000-000000000000",'
        '"adset_id":"123","link_url":"https://example.com"}',
        "--rationale",
        "contract test for redeploy_creative",
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["task_type"] == "redeploy_creative"
    assert payload["status"] == "pending"


# ---------- exit 2: malformed JSON in JSON args ----------


def test_log_decision_malformed_inputs_json_exits_2(
    invoke_tool, business_id, run_id, base_log_args
):
    r = invoke_tool(
        "log_decision",
        *base_log_args,
        "--inputs",
        "{not json",
    )
    assert r.returncode == 2
    assert "validation_error" in r.stdout or "VALIDATION" in r.stderr


def test_propose_task_malformed_payload_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "budget_change",
        "--payload",
        "{not json",
        "--rationale",
        "x",
    )
    assert r.returncode == 2


# ---------- exit 2: semantic validation (confidence out of range) ----------


def test_log_decision_confidence_out_of_range_exits_2(invoke_tool, base_log_args):
    r = invoke_tool("log_decision", *base_log_args, "--confidence", "1.5")
    assert r.returncode == 2


def test_propose_task_target_kind_without_target_id_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_task",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "budget_change",
        "--payload",
        "{}",
        "--rationale",
        "x",
        "--target-kind",
        "campaign",
        # --target-id omitted
    )
    assert r.returncode == 2


# ---------- Phase 1 (2026-05-13): Audience Manager tools ----------


def test_list_audiences_valid_args_exits_0(invoke_tool, business_id):
    """list_audiences is read-only; works against the empty-mirror state."""
    r = invoke_tool("list_audiences", "--business-id", business_id)
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["business_id"] == business_id
    assert "count" in payload
    assert "audiences" in payload
    assert isinstance(payload["audiences"], list)


def test_list_audiences_invalid_kind_exits_2(invoke_tool, business_id):
    r = invoke_tool(
        "list_audiences",
        "--business-id",
        business_id,
        "--kind",
        "bogus",
    )
    assert r.returncode == 2


def test_propose_audience_invalid_task_type_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "bogus",
        "--name",
        "x",
        "--intended-use",
        "x",
        "--rationale",
        "x",
    )
    assert r.returncode == 2


def test_propose_audience_custom_missing_subtype_exits_2(invoke_tool, business_id, run_id):
    """create_custom_audience requires --subtype."""
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_custom_audience",
        "--name",
        "test",
        "--intended-use",
        "בדיקת קונטרקט",
        "--rationale",
        "בדיקת קונטרקט",
        # --subtype omitted
    )
    assert r.returncode == 2


def test_propose_audience_custom_invalid_subtype_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_custom_audience",
        "--name",
        "test",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        "--subtype",
        "CUSTOM",  # PII subtype — Phase 2 only
    )
    assert r.returncode == 2


def test_propose_audience_lookalike_invalid_ratio_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_lookalike",
        "--name",
        "test",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        "--origin-audience-id",
        "12345",
        "--ratio",
        "0.25",  # > 0.10 max
    )
    assert r.returncode == 2


def test_propose_audience_saved_missing_targeting_exits_2(invoke_tool, business_id, run_id):
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_saved_audience",
        "--name",
        "test",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        # --targeting-spec omitted
    )
    assert r.returncode == 2


def test_propose_audience_custom_website_no_rule_exits_2(invoke_tool, business_id, run_id):
    """WEBSITE subtype requires --rule (Meta inclusions/exclusions spec)."""
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_custom_audience",
        "--name",
        "test",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        "--subtype",
        "WEBSITE",
        # --rule omitted
    )
    assert r.returncode == 2


def test_propose_audience_custom_engagement_valid_exits_0(invoke_tool, cleanup_run, business_id):
    """Happy path — ENGAGEMENT subtype needs no rule, lands as a pending row."""
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        cleanup_run,
        "--task-type",
        "create_custom_audience",
        "--name",
        "Aiweon-IG-engagers-90d",
        "--intended-use",
        "סגמנט retargeting לקמפיין הודעות חדש",
        "--rationale",
        "מסגמנט גולשים שכבר אינטראגרו עם הדף — בדיקת קונטרקט",
        "--subtype",
        "ENGAGEMENT",
        "--retention-days",
        "90",
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["task_type"] == "create_custom_audience"
    assert payload["status"] == "pending"
    assert payload["name"] == "Aiweon-IG-engagers-90d"


# ---------- Block 13 follow-up: --service-tag validation ----------


def test_propose_audience_service_tag_unknown_exits_2(invoke_tool, business_id, run_id):
    """A service_tag that isn't in business_knowledge.products is a validation error.

    Prevents the agent from proposing an audience tied to a service that
    doesn't exist — the §T_AUD invariant for per-service filtering.
    """
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_custom_audience",
        "--name",
        "ghost-service-audience",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        "--subtype",
        "ENGAGEMENT",
        "--service-tag",
        "this-service-does-not-exist-in-products-2026-05-13",
    )
    assert r.returncode == 2, f"expected exit 2, got {r.returncode}; stdout={r.stdout}"
    payload = json.loads(r.stdout)
    assert payload["error"] == "validation_error"
    assert "service-tag" in payload["message"] or "service_tag" in payload["message"]


def test_propose_audience_service_tag_blank_exits_2(invoke_tool, business_id, run_id):
    """Whitespace-only service_tag is rejected — caller passed it but it's empty."""
    r = invoke_tool(
        "propose_audience",
        "--business-id",
        business_id,
        "--run-id",
        run_id,
        "--task-type",
        "create_custom_audience",
        "--name",
        "blank-service",
        "--intended-use",
        "x",
        "--rationale",
        "x",
        "--subtype",
        "ENGAGEMENT",
        "--service-tag",
        "   ",
    )
    assert r.returncode == 2
    payload = json.loads(r.stdout)
    assert payload["error"] == "validation_error"


# ---------- Block 13 follow-up: build_website_audience_rule ----------


def test_build_website_audience_rule_help_exits_0(invoke_tool):
    """--help is the lightweight smoke test for every tool."""
    r = invoke_tool("build_website_audience_rule", "--help")
    assert r.returncode == 0


def test_build_website_audience_rule_missing_url_exits_2(invoke_tool):
    """Missing --website-url is an argparse failure (exit 2)."""
    r = invoke_tool("build_website_audience_rule")
    assert r.returncode == 2
    assert r.stderr  # argparse error message


def test_build_website_audience_rule_basic_exits_0(invoke_tool):
    """Bare-domain happy path — produces a Meta-shaped inclusions block."""
    r = invoke_tool(
        "build_website_audience_rule",
        "--website-url",
        "weon.co.il",
        "--days-back",
        "30",
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    payload = json.loads(r.stdout)
    assert payload["domain_matched"] == "weon.co.il"
    assert payload["retention_days"] == 30
    rule = payload["rule"]
    assert rule["inclusions"]["operator"] == "or"
    assert len(rule["inclusions"]["rules"]) == 1  # just the domain leaf
    leaf = rule["inclusions"]["rules"][0]
    assert leaf["retention_seconds"] == 30 * 86400
    filters = leaf["filter"]["filters"]
    # one url-contains for the domain, one event=PageView
    domain_filter = next(f for f in filters if f["field"] == "url")
    assert domain_filter["value"] == "weon.co.il"


def test_build_website_audience_rule_strips_scheme_and_www_exits_0(invoke_tool):
    """https:// and leading www. should not appear in the matched value."""
    r = invoke_tool(
        "build_website_audience_rule",
        "--website-url",
        "https://www.aiweon.co.il/",
    )
    assert r.returncode == 0
    payload = json.loads(r.stdout)
    assert payload["domain_matched"] == "aiweon.co.il"


def test_build_website_audience_rule_days_back_out_of_range_exits_2(invoke_tool):
    r = invoke_tool(
        "build_website_audience_rule",
        "--website-url",
        "weon.co.il",
        "--days-back",
        "365",  # max is 180
    )
    assert r.returncode == 2
    payload = json.loads(r.stdout)
    assert payload["error"] == "validation_error"


def test_build_website_audience_rule_exclusions_attached_exits_0(invoke_tool):
    r = invoke_tool(
        "build_website_audience_rule",
        "--website-url",
        "weon.co.il",
        "--exclude-path",
        "thank-you",
    )
    assert r.returncode == 0
    payload = json.loads(r.stdout)
    rule = payload["rule"]
    assert "exclusions" in rule
    assert rule["exclusions"]["operator"] == "or"
    assert len(rule["exclusions"]["rules"]) == 1
