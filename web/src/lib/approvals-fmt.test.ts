import { describe, it, expect } from "vitest";
import { parsePlanSection, parsePlanSteps } from "./approvals-fmt";

describe("parsePlanSection", () => {
  it("returns empty main and null plan for empty input", () => {
    expect(parsePlanSection(null)).toEqual({ main: "", plan: null });
    expect(parsePlanSection(undefined)).toEqual({ main: "", plan: null });
    expect(parsePlanSection("")).toEqual({ main: "", plan: null });
  });

  it("returns the whole text as main when there's no plan heading", () => {
    const r = "סתם הסבר על הקמפיין.\nשורה שניה.";
    expect(parsePlanSection(r)).toEqual({ main: r, plan: null });
  });

  it("splits at **תוכנית:** heading and returns the body as plan", () => {
    const r = `המודעה לא נצרכת.\n\n**תוכנית:**\n\n1. להרחיב קהל.\n2. לחזור בעוד 7 ימים.`;
    const { main, plan } = parsePlanSection(r);
    expect(main).toBe("המודעה לא נצרכת.");
    expect(plan).toBe("1. להרחיב קהל.\n2. לחזור בעוד 7 ימים.");
  });

  it("tolerates `**תוכנית**:` (colon outside bold) and `תוכנית:` (no bold)", () => {
    const r1 = `הסבר.\n**תוכנית**:\n1. א\n2. ב`;
    const r2 = `הסבר.\nתוכנית:\n1. א\n2. ב`;
    expect(parsePlanSection(r1).plan).toBe("1. א\n2. ב");
    expect(parsePlanSection(r2).plan).toBe("1. א\n2. ב");
  });

  it("uses first match — spurious 'תוכנית' later in prose doesn't break", () => {
    // The agent uses תוכנית in prose; the formal heading is at the bottom.
    // First match wins, which is the formal heading (it appears once).
    const r = `**תוכנית:**\n\n1. ראשון\n2. שני`;
    const { main, plan } = parsePlanSection(r);
    expect(main).toBe("");
    expect(plan).toBe("1. ראשון\n2. שני");
  });

  it("returns null plan when the heading has no body after it", () => {
    const r = "כל ההסבר.\n\n**תוכנית:**";
    expect(parsePlanSection(r)).toEqual({ main: r, plan: null });
  });

  it("trims trailing whitespace from main", () => {
    const r = "הסבר.\n\n\n\n**תוכנית:**\n1. א";
    expect(parsePlanSection(r).main).toBe("הסבר.");
  });
});

describe("parsePlanSteps", () => {
  it("returns each numbered step as a separate item", () => {
    const plan = "1. להרחיב קהל\n2. לחזור בעוד 7 ימים\n3. לבדוק objective";
    expect(parsePlanSteps(plan)).toEqual([
      "להרחיב קהל",
      "לחזור בעוד 7 ימים",
      "לבדוק objective",
    ]);
  });

  it("recognizes 1) and 1- and 1: markers", () => {
    expect(parsePlanSteps("1) א\n2) ב")).toEqual(["א", "ב"]);
    expect(parsePlanSteps("1 - א\n2 - ב")).toEqual(["א", "ב"]);
    expect(parsePlanSteps("1: א\n2: ב")).toEqual(["א", "ב"]);
  });

  it("keeps multi-line content under one step", () => {
    const plan = "1. שלב ראשון\n   ויש המשך\n2. שלב שני";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("שלב ראשון");
    expect(steps[0]).toContain("ויש המשך");
    expect(steps[1]).toBe("שלב שני");
  });

  it("returns the whole body as one item when there are no markers", () => {
    expect(parsePlanSteps("טקסט חופשי בלי מספור")).toEqual([
      "טקסט חופשי בלי מספור",
    ]);
  });
});
