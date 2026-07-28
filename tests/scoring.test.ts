import { describe, expect, it } from "vitest";
import { pickAreaComp, scoreListing, type CompLookup } from "../src/lib/scoring";
import type { ClozersListing } from "../src/lib/types";

function listing(overrides: Partial<ClozersListing> = {}): ClozersListing {
  return {
    listing_id: "l1",
    address: "123 Main St",
    price: 300000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    zip: "85260",
    subdivision: "Sunny Acres",
    posted_date: "2026-07-20",
    url: "https://app.clozers.co/listing/l1",
    ...overrides,
  };
}

function comps(overrides: Partial<CompLookup> = {}): CompLookup {
  return {
    bySubdivision: new Map(),
    byZip: new Map(),
    ...overrides,
  };
}

describe("pickAreaComp", () => {
  it("prefers subdivision comp when it meets the minimum comp count", () => {
    const lookup = comps({
      bySubdivision: new Map([
        ["Sunny Acres", { source: "subdivision", key: "Sunny Acres", avgPricePerSqft: 250, compCount: 5 }],
      ]),
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 200, compCount: 50 }],
      ]),
    });

    const result = pickAreaComp(listing(), lookup);
    expect(result?.source).toBe("subdivision");
    expect(result?.avgPricePerSqft).toBe(250);
  });

  it("falls back to zip comp when subdivision comp count is below the minimum", () => {
    const lookup = comps({
      bySubdivision: new Map([
        ["Sunny Acres", { source: "subdivision", key: "Sunny Acres", avgPricePerSqft: 250, compCount: 1 }],
      ]),
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 200, compCount: 50 }],
      ]),
    });

    const result = pickAreaComp(listing(), lookup);
    expect(result?.source).toBe("zip");
  });

  it("returns null when no comps exist for either dimension", () => {
    expect(pickAreaComp(listing(), comps())).toBeNull();
  });
});

describe("scoreListing", () => {
  it("flags on margin threshold", () => {
    // area avg $250/sqft * 1500 sqft = 375,000 ARV
    // rehab @ $25/sqft * 1500 = 37,500
    // price 250,000 -> margin = (375000 - 250000 - 37500) / 375000 = 23.3%
    const lookup = comps({
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 250, compCount: 10 }],
      ]),
    });

    const result = scoreListing(listing({ price: 250000 }), lookup);
    expect(result.flagged).toBe(true);
    expect(result.flag_reason).toContain("margin");
    expect(result.margin_pct).toBeCloseTo(0.2333, 3);
  });

  it("flags on below-area-average list price even with low margin", () => {
    // area avg $250/sqft, list price/sqft = $210 -> 16% below average
    // ARV = 375,000, rehab = 37,500, price = 315,000
    // margin = (375000 - 315000 - 37500) / 375000 = 5.7% (below margin threshold)
    const lookup = comps({
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 250, compCount: 10 }],
      ]),
    });

    const result = scoreListing(listing({ price: 315000, sqft: 1500 }), lookup);
    expect(result.list_price_per_sqft).toBe(210);
    expect(result.pct_below_area).toBeCloseTo(0.16, 3);
    expect(result.flagged).toBe(true);
    expect(result.flag_reason).toContain("below area avg");
    expect(result.margin_pct).toBeLessThan(0.2);
  });

  it("does not flag when neither signal clears its threshold", () => {
    const lookup = comps({
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 250, compCount: 10 }],
      ]),
    });

    // list price/sqft = $240 (4% below avg, under 12% threshold)
    // ARV 375,000, rehab 37,500, price 360,000 -> margin ~ -6% (not flagged)
    const result = scoreListing(listing({ price: 360000, sqft: 1500 }), lookup);
    expect(result.flagged).toBe(false);
    expect(result.flag_reason).toBeNull();
  });

  it("skips scoring when no comps are available", () => {
    const result = scoreListing(listing({ zip: "99999", subdivision: null }), comps());
    expect(result.flagged).toBe(false);
    expect(result.flag_reason).toBe("no comps available");
    expect(result.arv).toBeNull();
  });

  it("skips scoring when sqft is missing", () => {
    const lookup = comps({
      byZip: new Map([
        ["85260", { source: "zip", key: "85260", avgPricePerSqft: 250, compCount: 10 }],
      ]),
    });

    const result = scoreListing(listing({ sqft: null }), lookup);
    expect(result.flag_reason).toBe("missing sqft");
  });
});
