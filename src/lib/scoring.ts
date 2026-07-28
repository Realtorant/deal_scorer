import { config } from "./config";
import type { AreaComp, ClozersListing, ScoredListing } from "./types";

export interface CompLookup {
  bySubdivision: Map<string, AreaComp>;
  byZip: Map<string, AreaComp>;
}

export function pickAreaComp(
  listing: Pick<ClozersListing, "zip" | "subdivision">,
  comps: CompLookup
): AreaComp | null {
  if (listing.subdivision) {
    const subComp = comps.bySubdivision.get(listing.subdivision);
    if (subComp && subComp.compCount >= config.minSubdivisionComps) {
      return subComp;
    }
  }

  if (listing.zip) {
    const zipComp = comps.byZip.get(listing.zip);
    if (zipComp) return zipComp;
  }

  return null;
}

export function scoreListing(
  listing: ClozersListing,
  comps: CompLookup
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

  const areaComp = pickAreaComp(listing, comps);
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
    reasons.push(
      `list $/sqft ${(pctBelowArea * 100).toFixed(1)}% below area avg`
    );
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
