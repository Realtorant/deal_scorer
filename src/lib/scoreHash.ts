import { createHash } from "node:crypto";
import type { ScoredListing } from "./types";

/**
 * Stable hash over the fields that matter for "did this listing's score change"
 * — used to decide whether to re-email a listing that's still flagged from a
 * prior day but with materially different numbers (e.g. a price cut).
 */
export function hashScoredListing(scored: ScoredListing): string {
  const material = {
    flagged: scored.flagged,
    flag_reason: scored.flag_reason,
    margin_pct: roundOrNull(scored.margin_pct, 4),
    pct_below_area: roundOrNull(scored.pct_below_area, 4),
    arv: roundOrNull(scored.arv, 0),
    list_price_per_sqft: roundOrNull(scored.list_price_per_sqft, 2),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function roundOrNull(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
