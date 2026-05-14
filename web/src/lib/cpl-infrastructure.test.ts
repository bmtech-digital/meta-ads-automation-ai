import { describe, it, expect } from "vitest";
import {
  estimateCPL,
  matchSubVertical,
  pickGeoTier,
  SUBVERTICALS,
  PRIMARY_SOURCES,
} from "./cpl-infrastructure";

describe("estimateCPL — model arithmetic", () => {
  it("returns base × geo × stage × offer × channel × season", () => {
    // saas_marketing_tech base=420; all modifiers=1.0 → 420
    const r = estimateCPL({
      sub: "saas_marketing_tech",
      geo: "il_all_country",
      stage: "cold",
      offer: "consultation_free",
      channel: "lead_form",
      month: "mar",
      security_event: false,
    });
    expect(r.value_ils).toBe(420);
    expect(r.is_cpa).toBe(false);
  });

  it("applies demo_request friction (×1.8) for SaaS demos", () => {
    const r = estimateCPL({
      sub: "saas_marketing_tech",
      geo: "il_all_country",
      stage: "cold",
      offer: "demo_request",
      channel: "lead_form",
      month: "mar",
      security_event: false,
    });
    // 420 × 1.8 = 756
    expect(r.value_ils).toBe(756);
  });

  it("applies CTWA channel discount (×0.55) — biggest single lever in IL", () => {
    const base = estimateCPL({
      sub: "home_services",
      geo: "il_all_country",
      stage: "cold",
      offer: "consultation_free",
      channel: "lead_form",
      month: "mar",
      security_event: false,
    });
    const ctwa = estimateCPL({
      sub: "home_services",
      geo: "il_all_country",
      stage: "cold",
      offer: "consultation_free",
      channel: "click_to_whatsapp",
      month: "mar",
      security_event: false,
    });
    expect(ctwa.value_ils).toBe(Math.round(base.value_ils * 0.55));
  });

  it("compounds security event ×2 on top of seasonal", () => {
    const calm = estimateCPL({
      sub: "real_estate_residential",
      geo: "il_tel_aviv_center",
      stage: "cold",
      offer: "consultation_free",
      channel: "lead_form",
      month: "nov", // peak month ×1.15
      security_event: false,
    });
    const conflict = estimateCPL({
      sub: "real_estate_residential",
      geo: "il_tel_aviv_center",
      stage: "cold",
      offer: "consultation_free",
      channel: "lead_form",
      month: "nov",
      security_event: true,
    });
    // ±1 tolerance — calm is already rounded, so calm × 2 can differ by 1
    // from the unrounded × 2 path that conflict takes.
    expect(Math.abs(conflict.value_ils - calm.value_ils * 2)).toBeLessThanOrEqual(1);
  });

  it("treats ecommerce sub-verticals as CPA, not CPL", () => {
    const r = estimateCPL({
      sub: "ecom_fashion",
      geo: "il_all_country",
      stage: "cold",
      offer: "purchase",
      channel: "click_to_website",
      month: "mar",
      security_event: false,
    });
    expect(r.is_cpa).toBe(true);
  });

  it("ships citable primary sources with every estimate", () => {
    const r = estimateCPL({
      sub: "saas_marketing_tech",
      geo: "il_all_country",
      stage: "cold",
      offer: "demo_request",
      channel: "lead_form",
      month: "mar",
      security_event: false,
    });
    // At least 2 sources — satisfies guardrails §26 without WebSearch.
    expect(r.citations.length).toBeGreaterThanOrEqual(2);
    for (const c of r.citations) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.url.length).toBeGreaterThan(0);
      expect(c.extracted.length).toBeGreaterThan(0);
    }
  });

  it("produces a trace[] explaining each multiplier", () => {
    const r = estimateCPL({
      sub: "legal_personal",
      geo: "il_tel_aviv_center",
      stage: "cold",
      offer: "consultation_free",
      channel: "lead_form",
      month: "nov",
      security_event: false,
    });
    expect(r.trace[0].step).toContain("base");
    expect(r.trace.some((t) => t.step.includes("geo[il_tel_aviv_center]"))).toBe(true);
    expect(r.trace.some((t) => t.step.includes("season[nov]"))).toBe(true);
  });
});

describe("matchSubVertical — business_knowledge routing", () => {
  it("matches Aiweon-shaped input to saas_marketing_tech", () => {
    const r = matchSubVertical({
      vertical: "b2b_saas",
      products_raw: "פלטפורמת משפיענים לעסקים — influencer marketing platform",
      ideal_customer: "מנהלי שיווק בעסקים B2C",
      usp: "אוטומציה של קמפיינים שיווקיים",
      main_pain: null,
    });
    expect(r.sub).toBe("saas_marketing_tech");
    expect(r.confidence_of_match).toBe("exact");
  });

  it("falls back to 'other' when no products are given", () => {
    const r = matchSubVertical({
      vertical: null,
      products_raw: null,
      ideal_customer: null,
      usp: null,
      main_pain: null,
    });
    expect(r.sub).toBe("other");
    expect(r.confidence_of_match).toBe("fallback");
  });

  it("respects parent vertical — won't match saas_* when vertical=leads", () => {
    const r = matchSubVertical({
      vertical: "leads",
      products_raw: "marketing platform for influencer campaigns",
      ideal_customer: null,
      usp: null,
      main_pain: null,
    });
    expect(SUBVERTICALS[r.sub].parent).not.toBe("b2b_saas");
  });
});

describe("pickGeoTier — service_regions routing", () => {
  it("returns il_tel_aviv_center if any region is TLV-group", () => {
    expect(pickGeoTier(["תל אביב", "באר שבע"])).toBe("il_tel_aviv_center");
  });
  it("returns il_all_country for null or empty input", () => {
    expect(pickGeoTier(null)).toBe("il_all_country");
    expect(pickGeoTier([])).toBe("il_all_country");
  });
  it("returns il_periphery_mixed when multiple non-TLV tiers match", () => {
    expect(pickGeoTier(["באר שבע", "טבריה"])).toBe("il_periphery_mixed");
  });
});

describe("PRIMARY_SOURCES — citation contract", () => {
  it("every primary source has a non-empty extracted quote", () => {
    for (const id of Object.keys(PRIMARY_SOURCES) as Array<
      keyof typeof PRIMARY_SOURCES
    >) {
      const s = PRIMARY_SOURCES[id];
      expect(s.title).toBeTruthy();
      expect(s.url).toBeTruthy();
      expect(s.extracted.length).toBeGreaterThan(20);
    }
  });
});
