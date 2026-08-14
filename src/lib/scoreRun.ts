import { config } from "./config";
import type { Database } from "./database.types";
import { sendDigest, type DigestRow } from "./email";
import { hashScoredListing } from "./scoreHash";
import { scoreListing } from "./scoring";
import { getSupabaseClient } from "./supabase";
import type { AreaComp, ClozersListing, Comp, ScoredListing } from "./types";

type ScoredRow = Database["public"]["Tables"]["scored_listings"]["Insert"];
type SupabaseClient = ReturnType<typeof getSupabaseClient>;

export interface ScoreSummary {
  scored: number;
  emailed: number;
  // Listings whose zip is outside Maricopa coverage: logged (as scored_listings
  // rows with flag_reason) but not scored, so multi-county expansion can be sized
  // later. Never emailed.
  outOfCounty: number;
  // Set when the digest step failed. Scoring is already committed at that point,
  // so the run still succeeds — this just surfaces the delivery problem.
  emailError?: string;
}

/** The radius comp pool (last-12mo SFR sales with coords), paged in full. */
async function loadComps(supabase: SupabaseClient): Promise<Comp[]> {
  const comps: Comp[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("comps_with_coords")
      .select("lat,long,livable_sqft,price_per_sqft")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Failed to load comps_with_coords: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.lat === null || r.long === null || r.livable_sqft === null || r.price_per_sqft === null)
        continue;
      comps.push({ lat: r.lat, long: r.long, sqft: r.livable_sqft, pricePerSqft: r.price_per_sqft });
    }
    if (data.length < PAGE) break;
  }
  return comps;
}

/** Zip-level fallback averages + the set of zips we consider "in coverage". */
async function loadZipComps(
  supabase: SupabaseClient
): Promise<{ byZip: Map<string, AreaComp>; maricopaZips: Set<string> }> {
  const { data, error } = await supabase.from("comp_averages_by_zip").select("*");
  if (error) throw new Error(`Failed to load zip comps: ${error.message}`);

  const byZip = new Map<string, AreaComp>();
  const maricopaZips = new Set<string>();
  for (const row of data ?? []) {
    if (!row.zip) continue;
    maricopaZips.add(row.zip);
    if (row.avg_price_per_sqft !== null) {
      byZip.set(row.zip, {
        source: "zip",
        key: row.zip,
        avgPricePerSqft: row.avg_price_per_sqft,
        compCount: row.comp_count ?? 0,
      });
    }
  }
  return { byZip, maricopaZips };
}

function outOfCountyResult(listingId: string): ScoredListing {
  return {
    listing_id: listingId,
    comp_source: null,
    area_price_per_sqft: null,
    list_price_per_sqft: null,
    pct_below_area: null,
    arv: null,
    rehab_estimate: null,
    margin_pct: null,
    comp_count: null,
    flagged: false,
    flag_reason: "out of county (zip not in Maricopa coverage)",
  };
}

/**
 * Scores every active in-Maricopa Clozers listing against the radius comp ladder
 * (zip-level fallback), logs out-of-county listings, upserts the results, and
 * emails a digest of the newly-flagged-or-changed ones. Shared by the
 * /api/cron/score route and the local `npm run score` script.
 */
export async function runScoreAndDigest(): Promise<ScoreSummary> {
  const supabase = getSupabaseClient();

  const sinceScrapedAt = new Date();
  sinceScrapedAt.setUTCDate(sinceScrapedAt.getUTCDate() - config.clozersActiveWindowDays);

  const [{ data: listingRows, error: listingsError }, comps, zipData] = await Promise.all([
    supabase.from("clozers_listings").select("*").gte("scraped_at", sinceScrapedAt.toISOString()),
    loadComps(supabase),
    loadZipComps(supabase),
  ]);

  if (listingsError) {
    throw new Error(`Failed to load clozers_listings: ${listingsError.message}`);
  }

  const listings: ClozersListing[] = (listingRows ?? []).map((row) => ({
    listing_id: row.listing_id,
    address: row.address,
    price: row.price,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    zip: row.zip,
    subdivision: row.subdivision,
    posted_date: row.posted_date,
    url: row.url,
    lat: row.lat,
    long: row.long,
  }));

  if (listings.length === 0) {
    return { scored: 0, emailed: 0, outOfCounty: 0 };
  }

  const listingIds = listings.map((l) => l.listing_id);
  const { data: existingScores, error: existingError } = await supabase
    .from("scored_listings")
    .select("*")
    .in("listing_id", listingIds);

  if (existingError) {
    throw new Error(`Failed to load existing scored_listings: ${existingError.message}`);
  }

  const existingByListingId = new Map(
    (existingScores ?? []).map((row) => [row.listing_id, row])
  );

  const now = new Date().toISOString();
  const pendingEmail: { row: ScoredRow; digest: DigestRow; hash: string }[] = [];
  let outOfCounty = 0;

  const upsertRows: ScoredRow[] = listings.map((listing) => {
    const inCoverage = listing.zip !== null && zipData.maricopaZips.has(listing.zip);
    if (!inCoverage) outOfCounty += 1;

    const scored: ScoredListing = inCoverage
      ? scoreListing(listing, comps, zipData.byZip.get(listing.zip as string) ?? null)
      : outOfCountyResult(listing.listing_id);

    const hash = hashScoredListing(scored);
    const existing = existingByListingId.get(listing.listing_id);

    const row: ScoredRow = {
      listing_id: scored.listing_id,
      comp_source: scored.comp_source,
      area_price_per_sqft: scored.area_price_per_sqft,
      list_price_per_sqft: scored.list_price_per_sqft,
      pct_below_area: scored.pct_below_area,
      arv: scored.arv,
      rehab_estimate: scored.rehab_estimate,
      margin_pct: scored.margin_pct,
      comp_count: scored.comp_count,
      flagged: scored.flagged,
      flag_reason: scored.flag_reason,
      first_scored_at: existing?.first_scored_at ?? now,
      last_scored_at: now,
      // Preserve prior email state here; it only advances *after* a successful
      // send below, so a failed send never silently marks a listing as emailed.
      emailed_at: existing?.emailed_at ?? null,
      last_emailed_hash: existing?.last_emailed_hash ?? null,
    };

    const shouldEmail =
      scored.flagged && (!existing?.emailed_at || existing.last_emailed_hash !== hash);
    if (shouldEmail) {
      pendingEmail.push({ row, digest: { listing, scored }, hash });
    }

    return row;
  });

  const { error: upsertError } = await supabase
    .from("scored_listings")
    .upsert(upsertRows, { onConflict: "listing_id" });

  if (upsertError) {
    throw new Error(`Failed to upsert scored_listings: ${upsertError.message}`);
  }

  const scoredInCoverage = listings.length - outOfCounty;

  if (pendingEmail.length === 0) {
    return { scored: scoredInCoverage, emailed: 0, outOfCounty };
  }

  // Best-effort: scoring is already committed above, so a Resend/email failure
  // must never fail the whole run. Log it, surface it in the summary, return ok.
  try {
    await sendDigest(pendingEmail.map((p) => p.digest));

    // Send succeeded — now advance the email state for exactly what went out.
    const emailedAt = new Date().toISOString();
    const emailedRows = pendingEmail.map((p) => ({
      ...p.row,
      emailed_at: emailedAt,
      last_emailed_hash: p.hash,
    }));
    const { error: markError } = await supabase
      .from("scored_listings")
      .upsert(emailedRows, { onConflict: "listing_id" });

    if (markError) {
      throw new Error(`Digest sent but failed to record emailed state: ${markError.message}`);
    }

    return { scored: scoredInCoverage, emailed: pendingEmail.length, outOfCounty };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error("Digest step failed (scoring already committed):", emailError);
    return { scored: scoredInCoverage, emailed: 0, outOfCounty, emailError };
  }
}
