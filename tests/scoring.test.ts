import { describe, expect, it } from "vitest";
import {
  haversineMiles,
  scoreListing,
  selectRadiusComp,
} from "../src/lib/scoring";
import type { AreaComp, ClozersListing, Comp } from "../src/lib/types";

// A subject in central Phoenix.
const SUBJ = { lat: 33.45, long: -112.07, sqft: 1500 };

// Build a comp offset from the subject by ~`miles` east, with given sqft.
function compAt(milesEast: number, sqft: number, ppsf: number): Comp {
  const dLong = milesEast / (69 * Math.cos((SUBJ.lat * Math.PI) / 180));
  return { lat: SUBJ.lat, long: SUBJ.long + dLong, sqft, pricePerSqft: ppsf };
}

function listing(overrides: Partial<ClozersListing> = {}): ClozersListing {
  return {
    listing_id: "l1",
    address: "123 Main St",
    price: 300000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    zip: "85007",
    subdivision: null,
    posted_date: "2026-08-01",
    url: "https://app.clozers.co/x",
    lat: SUBJ.lat,
    long: SUBJ.long,
    ...overrides,
  };
}

describe("haversineMiles", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMiles(33.45, -112.07, 33.45, -112.07)).toBeLessThan(0.001);
  });
  it("matches a known ~1 mile offset", () => {
    const c = compAt(1.0, 1500, 200);
    expect(haversineMiles(SUBJ.lat, SUBJ.long, c.lat, c.long)).toBeCloseTo(1.0, 1);
  });
});

describe("selectRadiusComp ladder", () => {
  it("uses tier 1 (1mi/±15%) when >=5 comps qualify", () => {
    const comps = Array.from({ length: 6 }, () => compAt(0.5, 1500, 250));
    const r = selectRadiusComp(SUBJ, comps);
    expect(r?.source).toBe("radius");
    expect(r?.key).toBe("1mi/±15%");
    expect(r?.compCount).toBe(6);
    expect(r?.avgPricePerSqft).toBe(250);
  });

  it("falls to tier 2 (1.5mi) when tier 1 is short", () => {
    // 3 comps at 0.5mi (within 1mi) + 3 comps at 1.3mi (only within 1.5mi):
    // tier1 sees 3 (<5), tier2 sees 6.
    const comps = [
      ...Array.from({ length: 3 }, () => compAt(0.5, 1500, 200)),
      ...Array.from({ length: 3 }, () => compAt(1.3, 1500, 300)),
    ];
    const r = selectRadiusComp(SUBJ, comps);
    expect(r?.key).toBe("1.5mi/±15%");
    expect(r?.compCount).toBe(6);
    expect(r?.avgPricePerSqft).toBe(250);
  });

  it("falls to tier 3 (±20%) when size band must widen", () => {
    // 5 comps at 1.3mi sized 1750 (within ±20% of 1500 = 1200..1800, but outside
    // ±15% = 1275..1725). tier1/tier2 (±15%) see 0; tier3 (±20%) sees 5.
    const comps = Array.from({ length: 5 }, () => compAt(1.3, 1750, 220));
    const r = selectRadiusComp(SUBJ, comps);
    expect(r?.key).toBe("1.5mi/±20%");
    expect(r?.compCount).toBe(5);
  });

  it("returns null when no tier reaches the minimum", () => {
    const comps = Array.from({ length: 4 }, () => compAt(0.5, 1500, 250)); // only 4
    expect(selectRadiusComp(SUBJ, comps)).toBeNull();
  });

  it("excludes comps beyond 1.5 miles and outside ±20% sqft", () => {
    const comps = [
      ...Array.from({ length: 10 }, () => compAt(2.0, 1500, 250)), // too far
      ...Array.from({ length: 10 }, () => compAt(0.5, 2500, 250)), // too big
    ];
    expect(selectRadiusComp(SUBJ, comps)).toBeNull();
  });

  it("returns null without subject coordinates", () => {
    const comps = Array.from({ length: 6 }, () => compAt(0.5, 1500, 250));
    expect(selectRadiusComp({ lat: null, long: null, sqft: 1500 }, comps)).toBeNull();
  });
});

describe("scoreListing", () => {
  const zipComp: AreaComp = {
    source: "zip",
    key: "85007",
    avgPricePerSqft: 240,
    compCount: 50,
  };

  it("flags on below-area signal using radius comps", () => {
    // area $250/sqft, list 315000/1500 = $210/sqft -> 16% below
    const comps = Array.from({ length: 6 }, () => compAt(0.5, 1500, 250));
    const r = scoreListing(listing({ price: 315000 }), comps, zipComp);
    expect(r.comp_source).toBe("radius");
    expect(r.area_price_per_sqft).toBe(250);
    expect(r.flagged).toBe(true);
    expect(r.flag_reason).toContain("below area avg");
  });

  it("falls back to zip comp when radius ladder finds too few", () => {
    const comps = Array.from({ length: 2 }, () => compAt(0.5, 1500, 250));
    const r = scoreListing(listing({ price: 300000 }), comps, zipComp);
    expect(r.comp_source).toBe("zip");
    expect(r.area_price_per_sqft).toBe(240);
  });

  it("reports no comps when radius empty and no zip fallback", () => {
    const r = scoreListing(listing(), [], null);
    expect(r.flag_reason).toBe("no comps available");
    expect(r.arv).toBeNull();
  });

  it("skips when sqft missing", () => {
    const comps = Array.from({ length: 6 }, () => compAt(0.5, 1500, 250));
    const r = scoreListing(listing({ sqft: null }), comps, zipComp);
    expect(r.flag_reason).toBe("missing sqft");
  });
});
