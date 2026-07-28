import { config } from "../config";
import type { ClozersListing } from "../types";

// Undocumented internal endpoint backing https://app.clozers.co/spencers-list.
// Found by inspecting Network requests on the (public, no-login) page: it fetches
// this directly, then filters property type / beds / posted-date client-side in
// the React app. There's no public API contract here — this can change without
// notice. If it breaks, re-inspect Network on the Spencer's List page for the new
// shape; a DOM-scrape fallback would be the next thing to build.
const DEALS_API_URL = "https://api.clozers.co/v1/spencers-deals?limit=100";

// The endpoint 500s without these — it appears to validate Origin/Referer against
// the real app rather than requiring an API key.
const REQUEST_HEADERS = {
  Accept: "application/json",
  Origin: "https://app.clozers.co",
  Referer: "https://app.clozers.co/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

interface RawClozersDeal {
  dealId: string;
  propertyType: string;
  askingPrice: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  postedAt: string | null;
  // Firestore timestamp for when Clozers' scanner last reconfirmed this deal as
  // active. The Spencer's List UI's "Posted: Last N days" filter actually keys
  // off this, not postedAt (confirmed against a live sample — postedAt can be
  // much older than lastSeenAt for a deal that's still being resurfaced).
  lastSeenAt: { _seconds: number; _nanoseconds: number } | null;
  postUrl: string | null;
  address: {
    zipcode: string | null;
    city: string | null;
    streetAddress: string | null;
    label: string | null;
    state: string | null;
  };
  sourceUrls?: {
    realtor?: string | null;
    redfin?: string | null;
    zillow?: string | null;
  };
}

// Observed one transient 500 during testing against this undocumented endpoint —
// a single retry is cheap insurance for the daily cron run.
async function fetchRawDeals(): Promise<RawClozersDeal[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(DEALS_API_URL, { headers: REQUEST_HEADERS });
      if (!response.ok) {
        throw new Error(`Clozers deals request failed: ${response.status} ${response.statusText}`);
      }
      const body = (await response.json()) as { deals?: RawClozersDeal[] };
      return body.deals ?? [];
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

function pickListingUrl(deal: RawClozersDeal): string {
  const sourceUrl =
    deal.sourceUrls?.realtor || deal.sourceUrls?.redfin || deal.sourceUrls?.zillow;
  return sourceUrl || deal.postUrl || `https://app.clozers.co/spencers-list`;
}

function normalize(deal: RawClozersDeal): ClozersListing | null {
  if (deal.askingPrice === null || deal.askingPrice === undefined) return null;

  return {
    listing_id: deal.dealId,
    address: deal.address?.label || deal.address?.streetAddress || "Unknown address",
    price: deal.askingPrice,
    beds: deal.bedrooms,
    baths: deal.bathrooms,
    sqft: deal.squareFeet,
    zip: deal.address?.zipcode ?? null,
    subdivision: null, // Clozers doesn't expose subdivision; scoring falls back to zip.
    posted_date: deal.postedAt ? deal.postedAt.slice(0, 10) : null,
    url: pickListingUrl(deal),
    raw: deal as unknown as Record<string, unknown>,
  };
}

/**
 * Fetches the raw feed and applies the same filters as the spec'd Spencer's
 * List URL (propTypes=SFR&beds=2&posted=7) — done client-side here since the
 * API itself ignores those query params and always returns its full recent batch.
 */
export async function scrapeClozersListings(): Promise<ClozersListing[]> {
  const deals = await fetchRawDeals();
  const cutoff = Date.now() - config.clozersPostedWithinDays * 24 * 3600 * 1000;

  return deals
    .filter((d) => d.propertyType === "Single Family")
    .filter((d) => (d.bedrooms ?? 0) >= config.clozersMinBeds)
    .filter((d) => (d.lastSeenAt ? d.lastSeenAt._seconds * 1000 >= cutoff : false))
    .map(normalize)
    .filter((l): l is ClozersListing => l !== null);
}
