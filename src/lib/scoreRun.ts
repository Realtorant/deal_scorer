import { config } from "./config";
import type { Database } from "./database.types";
import { sendDigest, type DigestRow } from "./email";
import { hashScoredListing } from "./scoreHash";
import { scoreListing, type CompLookup } from "./scoring";
import { getSupabaseClient } from "./supabase";
import type { AreaComp, ClozersListing } from "./types";

type ScoredRow = Database["public"]["Tables"]["scored_listings"]["Insert"];

export interface ScoreSummary {
  scored: number;
  emailed: number;
  // Set when the digest step failed. Scoring is already committed at that point,
  // so the run still succeeds — this just surfaces the delivery problem.
  emailError?: string;
}

async function loadCompLookup(
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<CompLookup> {
  const [zipComps, subdivisionComps] = await Promise.all([
    supabase.from("comp_averages_by_zip").select("*"),
    supabase.from("comp_averages_by_subdivision").select("*"),
  ]);

  if (zipComps.error) throw new Error(`Failed to load zip comps: ${zipComps.error.message}`);
  if (subdivisionComps.error)
    throw new Error(`Failed to load subdivision comps: ${subdivisionComps.error.message}`);

  const byZip = new Map<string, AreaComp>();
  for (const row of zipComps.data ?? []) {
    if (!row.zip || row.avg_price_per_sqft === null) continue;
    byZip.set(row.zip, {
      source: "zip",
      key: row.zip,
      avgPricePerSqft: row.avg_price_per_sqft,
      compCount: row.comp_count ?? 0,
    });
  }

  const bySubdivision = new Map<string, AreaComp>();
  for (const row of subdivisionComps.data ?? []) {
    if (!row.subdivision || row.avg_price_per_sqft === null) continue;
    bySubdivision.set(row.subdivision, {
      source: "subdivision",
      key: row.subdivision,
      avgPricePerSqft: row.avg_price_per_sqft,
      compCount: row.comp_count ?? 0,
    });
  }

  return { byZip, bySubdivision };
}

/**
 * Scores every active Clozers listing against the comp averages, upserts the
 * results, and emails a digest of the newly-flagged-or-changed ones. Shared by
 * the /api/cron/score route and the local `npm run score` script.
 */
export async function runScoreAndDigest(): Promise<ScoreSummary> {
  const supabase = getSupabaseClient();

  const sinceScrapedAt = new Date();
  sinceScrapedAt.setUTCDate(sinceScrapedAt.getUTCDate() - config.clozersActiveWindowDays);

  const [{ data: listingRows, error: listingsError }, compLookup] = await Promise.all([
    supabase
      .from("clozers_listings")
      .select("*")
      .gte("scraped_at", sinceScrapedAt.toISOString()),
    loadCompLookup(supabase),
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
  }));

  if (listings.length === 0) {
    return { scored: 0, emailed: 0 };
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

  const upsertRows: ScoredRow[] = listings.map((listing) => {
    const scored = scoreListing(listing, compLookup);
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

  if (pendingEmail.length === 0) {
    return { scored: listings.length, emailed: 0 };
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

    return { scored: listings.length, emailed: pendingEmail.length };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error("Digest step failed (scoring already committed):", emailError);
    return { scored: listings.length, emailed: 0, emailError };
  }
}
