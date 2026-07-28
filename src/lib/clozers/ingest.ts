import { getSupabaseClient } from "../supabase";
import type { ClozersListing } from "../types";
import { scrapeClozersListings } from "./fetchDeals";

export interface ClozersIngestSummary {
  scraped: number;
  upserted: number;
}

export async function ingestClozersListings(): Promise<ClozersIngestSummary> {
  const listings = await scrapeClozersListings();
  if (listings.length === 0) {
    return { scraped: 0, upserted: 0 };
  }

  const supabase = getSupabaseClient();
  const rows = listings.map((listing: ClozersListing) => ({
    listing_id: listing.listing_id,
    address: listing.address,
    price: listing.price,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    zip: listing.zip,
    subdivision: listing.subdivision,
    posted_date: listing.posted_date,
    url: listing.url,
    raw: listing.raw ?? null,
    scraped_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("clozers_listings")
    .upsert(rows, { onConflict: "listing_id" });

  if (error) throw new Error(`Failed to upsert clozers_listings: ${error.message}`);

  return { scraped: listings.length, upserted: rows.length };
}
