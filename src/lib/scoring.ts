import { config } from "./config";
import type { AreaComp, ClozersListing, Comp, ScoredListing } from "./types";

// Comp-selection ladder: use the first tier that yields >= config.compMinCount
// comps; otherwise fall back to the zip-level average. Validated against real
// data (see the comp-radius report) — at min 5, ~99% of in-county subjects
// resolve on a distance tier and the zip fallback is almost never needed.
export const COMP_LADDER: { radiusMi: number; sqftPct: number; label: string }[] = [
  { radiusMi: 1.0, sqftPct: 0.15, label: "1mi/±15%" },
  { radiusMi: 1.5, sqftPct: 0.15, label: "1.5mi/±15%" },
  { radiusMi: 1.5, sqftPct: 0.2, label: "1.5mi/±20%" },
];

const EARTH_RADIUS_MI = 3958.7613;
const MAX_LADDER_RADIUS_MI = Math.max(...COMP_LADDER.map((t) => t.radiusMi));

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

export interface CompSubject {
  lat: number | null;
  long: number | null;
  sqft: number | null;
}

interface LadderMatch {
  tier: (typeof COMP_LADDER)[number];
  matched: Comp[];
}

/**
 * Shared core of the ladder walk: finds the first tier meeting the comp
 * minimum and returns which tier won plus exactly which comps qualified.
 * selectRadiusComp() and selectRadiusCompDetails() both build on this so
 * there's one implementation of the ladder logic, not two that could drift.
 */
function findWinningTier(subject: CompSubject, comps: Comp[]): LadderMatch | null {
  const { lat, long, sqft } = subject;
  if (lat === null || long === null || !sqft || sqft <= 0) return null;

  const dLat = MAX_LADDER_RADIUS_MI / 69;
  const dLong = MAX_LADDER_RADIUS_MI / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  // Distance once per nearby comp, reused across tiers.
  const nearby: { comp: Comp; dist: number }[] = [];
  for (const comp of comps) {
    if (Math.abs(comp.lat - lat) > dLat || Math.abs(comp.long - long) > dLong) continue;
    const dist = haversineMiles(lat, long, comp.lat, comp.long);
    if (dist <= MAX_LADDER_RADIUS_MI) nearby.push({ comp, dist });
  }

  for (const tier of COMP_LADDER) {
    const lo = sqft * (1 - tier.sqftPct);
    const hi = sqft * (1 + tier.sqftPct);
    const selected = nearby.filter(
      (n) => n.dist <= tier.radiusMi && n.comp.sqft >= lo && n.comp.sqft <= hi
    );
    if (selected.length >= config.compMinCount) {
      return { tier, matched: selected.map((n) => n.comp) };
    }
  }

  return null;
}

function averagePricePerSqft(comps: Comp[]): number {
  return comps.reduce((s, c) => s + c.pricePerSqft, 0) / comps.length;
}

/**
 * Walks the ladder and returns the first tier's radius comp (avg $/sqft over the
 * qualifying comps) that meets the minimum count, or null if none does. Uses a
 * bounding-box prefilter so it stays cheap over the full county comp pool.
 */
export function selectRadiusComp(subject: CompSubject, comps: Comp[]): AreaComp | null {
  const match = findWinningTier(subject, comps);
  if (!match) return null;
  return {
    source: "radius",
    key: match.tier.label,
    avgPricePerSqft: averagePricePerSqft(match.matched),
    compCount: match.matched.length,
  };
}

export interface RadiusCompDetails {
  areaComp: AreaComp;
  matchedComps: Comp[];
  tierLabel: string;
  radiusMi: number;
  sqftPct: number;
}

/**
 * Same ladder walk as selectRadiusComp, but also returns which individual
 * comps matched the winning tier — used by the comp packet generator to
 * render an actual sold-comps table, not just the aggregate.
 */
export function selectRadiusCompDetails(
  subject: CompSubject,
  comps: Comp[]
): RadiusCompDetails | null {
  const match = findWinningTier(subject, comps);
  if (!match) return null;
  return {
    areaComp: {
      source: "radius",
      key: match.tier.label,
      avgPricePerSqft: averagePricePerSqft(match.matched),
      compCount: match.matched.length,
    },
    matchedComps: match.matched,
    tierLabel: match.tier.label,
    radiusMi: match.tier.radiusMi,
    sqftPct: match.tier.sqftPct,
  };
}

/**
 * Scores a listing against the radius ladder, falling back to the zip-level
 * average only when no distance tier meets the comp minimum.
 */
export function scoreListing(
  listing: ClozersListing,
  comps: Comp[],
  zipComp: AreaComp | null
): ScoredListing {
  const base: ScoredListing = {
    listing_id: listing.listing_id,
    comp_source: null,
    area_price_per_sqft: null,
    list_price_per_sqft: null,
    pct_below_area: null,
    arv: null,
    rehab_estimate: null,
    margin_pct: null,
    comp_count: null,
    flagged: false,
    flag_reason: null,
  };

  if (!listing.sqft || listing.sqft <= 0) {
    return { ...base, flag_reason: "missing sqft" };
  }

  const areaComp =
    selectRadiusComp(
      { lat: listing.lat, long: listing.long, sqft: listing.sqft },
      comps
    ) ?? zipComp;

  if (!areaComp) {
    return { ...base, flag_reason: "no comps available" };
  }

  const listPricePerSqft = listing.price / listing.sqft;
  const pctBelowArea =
    (areaComp.avgPricePerSqft - listPricePerSqft) / areaComp.avgPricePerSqft;
  const arv = areaComp.avgPricePerSqft * listing.sqft;
  const rehabEstimate = config.rehabPerSqft * listing.sqft;
  const marginPct = (arv - listing.price - rehabEstimate) / arv;

  const reasons: string[] = [];
  if (marginPct >= config.marginThreshold) {
    reasons.push(`margin ${(marginPct * 100).toFixed(1)}% >= threshold`);
  }
  if (pctBelowArea >= config.belowAvgThreshold) {
    reasons.push(`list $/sqft ${(pctBelowArea * 100).toFixed(1)}% below area avg`);
  }

  return {
    listing_id: listing.listing_id,
    comp_source: areaComp.source,
    area_price_per_sqft: areaComp.avgPricePerSqft,
    list_price_per_sqft: listPricePerSqft,
    pct_below_area: pctBelowArea,
    arv,
    rehab_estimate: rehabEstimate,
    margin_pct: marginPct,
    comp_count: areaComp.compCount,
    flagged: reasons.length > 0,
    flag_reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}
