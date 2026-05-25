import { describe, it, expect } from "vitest";
import { summarizeRun, buildRunNarrative, groupDecisions } from "./runs-summary";
import type { AgentDecision, DecisionType } from "./db/types";

/**
 * Tests focused on the observation_blocked path added with Migration 033
 * (`docs/todos/capability-gated-decision-flow.md`). The pre-existing
 * summarizeRun shape (gates, top finding) is intentionally covered by
 * the surface-runs-detail TODO's e2e expectation — this file just locks
 * in the new behaviour around blocked findings.
 */

const baseDecision = (over: Partial<AgentDecision>): AgentDecision => ({
  id: "id-" + Math.random().toString(36).slice(2, 9),
  business_id: "biz",
  run_id: "run",
  graph_name: "observe_propose",
  node_name: "diagnose",
  created_at: new Date().toISOString(),
  decision_type: "observation" as DecisionType,
  summary: "summary",
  rationale: null,
  inputs: null,
  outputs: null,
  related_approval_id: null,
  campaign_id: null,
  adset_id: null,
  ad_id: null,
  llm_model: null,
  llm_tokens_in: null,
  llm_tokens_out: null,
  latency_ms: null,
  guardrail_violations: null,
  confidence: null,
  ...over,
});

describe("summarizeRun — observation_blocked support", () => {
  it("counts observation_blocked rows independently of skip/rejection", () => {
    const h = summarizeRun([
      baseDecision({ decision_type: "skip", summary: "s1" }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "ob1",
        outputs: { finding_type: "objective_mismatch", blocked_by: ["tracking_verified"] },
      }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "ob2",
        outputs: { finding_type: "staged_scale_up", blocked_by: ["tracking_verified"] },
      }),
      baseDecision({ decision_type: "rejection", summary: "r1" }),
    ]);
    expect(h.observationBlockedCount).toBe(2);
    expect(h.skipCount).toBe(1);
    expect(h.rejectionCount).toBe(1);
  });

  it("collects blockedFindings with parsed blocked_by + finding_type", () => {
    const h = summarizeRun([
      baseDecision({
        id: "d-1",
        decision_type: "observation_blocked",
        summary: "objective mismatch on AI agent campaign",
        campaign_id: "c-1",
        outputs: {
          finding_type: "objective_mismatch",
          blocked_by: ["tracking_verified", "primary_kpi_set"],
        },
      }),
    ]);
    expect(h.blockedFindings).toHaveLength(1);
    expect(h.blockedFindings[0]).toMatchObject({
      decisionId: "d-1",
      findingType: "objective_mismatch",
      blockedBy: ["tracking_verified", "primary_kpi_set"],
      campaignId: "c-1",
    });
  });

  it("caps blockedFindings at 5 entries", () => {
    const decisions = Array.from({ length: 12 }, (_, i) =>
      baseDecision({
        id: `d-${i}`,
        decision_type: "observation_blocked",
        summary: `blocked ${i}`,
        outputs: { finding_type: "x", blocked_by: ["tracking_verified"] },
      }),
    );
    const h = summarizeRun(decisions);
    expect(h.blockedFindings).toHaveLength(5);
  });

  it("falls back topFinding to 'blocked' when only observation_blocked rows are present", () => {
    const h = summarizeRun([
      baseDecision({
        decision_type: "observation_blocked",
        summary: "scale_up wanted but tracking unverified",
        outputs: { finding_type: "staged_scale_up", blocked_by: ["tracking_verified"] },
      }),
    ]);
    expect(h.topFinding).not.toBeNull();
    expect(h.topFinding?.kind).toBe("blocked");
  });

  it("keeps error as the highest-priority topFinding even when blocked findings exist", () => {
    const h = summarizeRun([
      baseDecision({ decision_type: "error", summary: "tool failed" }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "...",
        outputs: { blocked_by: ["x"] },
      }),
    ]);
    expect(h.topFinding?.kind).toBe("error");
  });

  it("tolerates outputs without blocked_by by emitting an empty list", () => {
    const h = summarizeRun([
      baseDecision({
        decision_type: "observation_blocked",
        summary: "no blocked_by",
        outputs: { finding_type: "x" },
      }),
    ]);
    expect(h.blockedFindings[0].blockedBy).toEqual([]);
  });
});

describe("buildRunNarrative — debug page TL;DR", () => {
  it("classifies as 'empty' when nothing actionable happened", () => {
    const n = buildRunNarrative([
      baseDecision({ decision_type: "observation", summary: "o1" }),
      baseDecision({ decision_type: "observation", summary: "o2" }),
      baseDecision({ decision_type: "skip", summary: "s1" }),
    ]);
    expect(n.shape).toBe("empty");
    expect(n.observations).toBe(2);
    expect(n.skips).toBe(1);
    expect(n.wouldPropose).toBe(0);
    expect(n.sentence).toMatch(/לא זוהו ממצאים/);
  });

  it("classifies as 'blocked' when findings exist but capabilities gated them", () => {
    const n = buildRunNarrative([
      baseDecision({ decision_type: "observation", summary: "o1" }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "b1",
        outputs: { blocked_by: ["tracking_verified"] },
      }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "b2",
        outputs: { blocked_by: ["primary_kpi_set"] },
      }),
    ]);
    expect(n.shape).toBe("blocked");
    expect(n.blocked).toBe(2);
    expect(n.wouldPropose).toBe(2);
    expect(n.sentence).toMatch(/חסומים/);
  });

  it("classifies as 'rejected' when guardrails killed proposals and nothing got through", () => {
    const n = buildRunNarrative([
      baseDecision({ decision_type: "rejection", summary: "r1" }),
      baseDecision({ decision_type: "rejection", summary: "r2" }),
    ]);
    expect(n.shape).toBe("rejected");
    expect(n.rejected).toBe(2);
    expect(n.sentence).toMatch(/guardrails/);
  });

  it("classifies as 'productive' when at least one proposal made it through", () => {
    const n = buildRunNarrative([
      baseDecision({ decision_type: "proposal", summary: "p1" }),
      baseDecision({
        decision_type: "observation_blocked",
        summary: "b1",
        outputs: { blocked_by: ["x"] },
      }),
    ]);
    expect(n.shape).toBe("productive");
    expect(n.proposals).toBe(1);
    expect(n.sentence).toMatch(/הצעות חדשות/);
    // Mentions the blocked finding as context.
    expect(n.sentence).toMatch(/חסומים/);
  });

  it("classifies as 'errored' even when other buckets are non-empty", () => {
    const n = buildRunNarrative([
      baseDecision({ decision_type: "error", summary: "boom" }),
      baseDecision({ decision_type: "proposal", summary: "p1" }),
    ]);
    expect(n.shape).toBe("errored");
    expect(n.errors).toBe(1);
    expect(n.sentence).toMatch(/שגיאות/);
  });
});

describe("groupDecisions — bucketing for accordions", () => {
  it("routes each decision_type to its own bucket and preserves order", () => {
    const decisions = [
      baseDecision({ id: "a", decision_type: "observation", summary: "skip-me" }),
      baseDecision({ id: "b", decision_type: "observation_blocked", summary: "b1" }),
      baseDecision({ id: "c", decision_type: "rejection", summary: "r1" }),
      baseDecision({ id: "d", decision_type: "skip", summary: "s1" }),
      baseDecision({ id: "e", decision_type: "proposal", summary: "p1" }),
      baseDecision({ id: "f", decision_type: "error", summary: "e1" }),
      baseDecision({ id: "g", decision_type: "observation_blocked", summary: "b2" }),
    ];
    const g = groupDecisions(decisions);
    expect(g.blockedFindings.map((d) => d.id)).toEqual(["b", "g"]);
    expect(g.rejections.map((d) => d.id)).toEqual(["c"]);
    expect(g.skips.map((d) => d.id)).toEqual(["d"]);
    expect(g.proposals.map((d) => d.id)).toEqual(["e"]);
    expect(g.errors.map((d) => d.id)).toEqual(["f"]);
  });
});
