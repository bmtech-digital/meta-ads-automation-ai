import { describe, it, expect } from "vitest";
import {
  classifyAgainstBenchmark,
  getBenchmark,
  formatBandHe,
} from "./kpi-benchmarks";

describe("getBenchmark", () => {
  it("returns null for KPIs that don't apply to the vertical", () => {
    expect(getBenchmark("awareness", "cpa")).toBeNull();
    expect(getBenchmark("awareness", "cpl")).toBeNull();
    expect(getBenchmark("leads", "cpa")).toBeNull();
    expect(getBenchmark("ecommerce", "cpl")).toBeNull();
  });

  it("returns a band for leads.cpl", () => {
    const b = getBenchmark("leads", "cpl");
    expect(b).not.toBeNull();
    expect(b!.median).toBe(90);
    expect(b!.implausible_below).toBe(15);
  });

  it("falls back to 'other' bands when vertical is null", () => {
    const b = getBenchmark(null, "cpl");
    expect(b).not.toBeNull();
  });
});

describe("classifyAgainstBenchmark — CPL (lower=better)", () => {
  const band = getBenchmark("leads", "cpl")!;

  it("calls ₪1 implausible", () => {
    expect(classifyAgainstBenchmark(1, "cpl", band)).toBe("implausible");
  });

  it("calls ₪10 implausible (below floor)", () => {
    expect(classifyAgainstBenchmark(10, "cpl", band)).toBe("implausible");
  });

  it("calls ₪40 good (≤ good_max=60)", () => {
    expect(classifyAgainstBenchmark(40, "cpl", band)).toBe("good");
  });

  it("calls ₪120 ok (good_max < x ≤ realistic_max=180)", () => {
    expect(classifyAgainstBenchmark(120, "cpl", band)).toBe("ok");
  });

  it("calls ₪250 worrying (realistic_max < x ≤ unambitious=400)", () => {
    expect(classifyAgainstBenchmark(250, "cpl", band)).toBe("worrying");
  });

  it("calls ₪500 off_band (> unambitious)", () => {
    expect(classifyAgainstBenchmark(500, "cpl", band)).toBe("off_band");
  });
});

describe("formatBandHe", () => {
  it("leads with the median (₪90 for leads.cpl) so the single 'average' is visible", () => {
    const band = getBenchmark("leads", "cpl")!;
    const s = formatBandHe("cpl", band);
    expect(s).toContain("ממוצע ₪90");
    expect(s).toContain("₪60");
    expect(s).toContain("₪180");
  });

  it("formats ROAS band in multiplier", () => {
    const band = getBenchmark("ecommerce", "roas")!;
    const s = formatBandHe("roas", band);
    expect(s).toContain("ממוצע");
    expect(s).toContain("x");
    expect(s).toContain("מצוין");
  });
});
