import { config } from "./config";
import type { Database } from "./database.types";
import { sendDigest, sendFailureAlert, type DigestRow } from "./email";
import { scoreListing } from "./scoring";
import { getSupabaseClient } from "./supabase";
import type { AreaComp, ClozersListing, Comp } from "./types";

type ScoredRow = Database["public"]["Tables"]["scored_listings"]["Insert"];
type SupabaseClient = ReturnType<typeof getSupabaseClient>;

export interface ScoreSummary {
  scored: number;
  emailed: number;
  // Listings whose zip is outside Maricopa coverage: filtered out of scoring and
  // logged minimally (a one-line console log of the distinct zips). Not stored.
  outOfCounty: number;
  // True when there was something to send (a digest or a heartbeat) but it was
  // held back for being outside the work-hours window. Scoring/upserting still
  // happened as normal; the held listings stay unmarked and roll into the next
  // in-window run.
  sendSuppressed?: boolean;
  // Set when the digest step failed. Scoring is already committed at that point,
  // so the run still succeeds — this just surfaces the delivery problem.
  emailError?: string;
}

const ARIZONA_TZ = "America/Phoenix"; // fixed UTC-7, no DST, so this is always correct

/** True when `date` falls within the configured Arizona-local send window. */
function isWithinSendWindow(date: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ARIZONA_TZ,
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  return hour >= config.digestSendWindowStartHour && hour < config.digestSendWindowEndHour;
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

/**
 * Scores every active in-Maricopa Clozers listing against the radius comp ladder
 * (zip-level fallback), logs out-of-county listings, and upserts the results.
 * Always emails within the work-hours window — a table of newly-flagged-or-
 * changed listings if there are any, otherwise a "checked, no new deals"
 * heartbeat — so a quiet run is a clear liveness signal rather than silence to
 * interpret. Shared by the /api/cron/score route and the local `npm run score`
 * script.
 *
 * A failure anywhere in the pipeline (not just the digest step) triggers a
 * best-effort "run FAILED" alert email before re-throwing, so a broken run is
 * never just a silent 500 — the one exception is Resend itself being down,
 * which has no fallback channel and just logs to the function's console.
 */
export async function runScoreAndDigest(): Promise<ScoreSummary> {
  try {
    return await scoreAndDigest();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Score run failed before the digest step:", message);
    try {
      await sendFailureAlert(message);
    } catch (alertErr) {
      console.error("Also failed to send the failure alert email:", alertErr);
    }
    throw err;
  }
}

async function scoreAndDigest(): Promise<ScoreSummary> {
  // Fail fast and loud here (via the outer wrapper's alert + a real 500)
  // instead of letting a missing config surface only inside the digest step's
  // best-effort catch below, where it would be silently absorbed into an
  // emailError field nobody's reading while the route reports a false 200.
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_TO_EMAIL) {
    throw new Error(
      "RESEND_API_KEY and/or DIGEST_TO_EMAIL are not set in this environment — cannot email the digest."
    );
  }

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

  // Falls through to the send-digest step below even when empty (rather than an
  // early return) so a genuinely empty active-listings window still emails a
  // heartbeat instead of going silent — arguably the case most worth catching.
  const listingIds = listings.map((l) => l.listing_id);
  const { data: existingScores, error: existingError } =
    listingIds.length > 0
      ? await supabase.from("scored_listings").select("*").in("listing_id", listingIds)
      : { data: [], error: null };

  if (existingError) {
    throw new Error(`Failed to load existing scored_listings: ${existingError.message}`);
  }

  const existingByListingId = new Map(
    (existingScores ?? []).map((row) => [row.listing_id, row])
  );

  const now = new Date().toISOString();
  const pendingEmail: { row: ScoredRow; digest: DigestRow }[] = [];
  const upsertRows: ScoredRow[] = [];
  const outOfCountyZips = new Set<string>();

  for (const listing of listings) {
    // Filter out (don't score, don't store) listings outside Maricopa coverage.
    if (listing.zip === null || !zipData.maricopaZips.has(listing.zip)) {
      if (listing.zip) outOfCountyZips.add(listing.zip);
      continue;
    }

    const scored = scoreListing(listing, comps, zipData.byZip.get(listing.zip) ?? null);
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
      // send below, so a failed (or held-for-window) send never silently marks
      // a listing as emailed.
      emailed_at: existing?.emailed_at ?? null,
      last_emailed_price: existing?.last_emailed_price ?? null,
    };

    // Dedup keys off the LISTING's own price, not derived scoring fields
    // (margin_pct/arv/etc. drift on their own as the comp pool changes week to
    // week — hashing those caused spurious re-sends of listings that hadn't
    // actually changed). A listing is only ever re-emailed if its price has
    // materially changed since the last successful send.
    const shouldEmail =
      scored.flagged && (!existing?.emailed_at || existing.last_emailed_price !== listing.price);
    if (shouldEmail) {
      pendingEmail.push({ row, digest: { listing, scored } });
    }

    upsertRows.push(row);
  }

  const outOfCounty = listings.length - upsertRows.length;
  if (outOfCounty > 0) {
    console.log(
      `Skipped ${outOfCounty} out-of-county listing(s); zips: ${[...outOfCountyZips].sort().join(", ")}`
    );
  }

  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("scored_listings")
      .upsert(upsertRows, { onConflict: "listing_id" });
    if (upsertError) {
      throw new Error(`Failed to upsert scored_listings: ${upsertError.message}`);
    }
  }

  const scoredInCoverage = upsertRows.length;

  // Scoring/upserting always happens on schedule; only the send itself is
  // gated to work hours. Listings held back here stay unmarked (emailed_at
  // untouched above) so they roll into the next in-window run's pendingEmail
  // automatically — no separate batching state needed.
  if (!isWithinSendWindow(new Date())) {
    if (pendingEmail.length > 0) {
      console.log(
        `Outside the ${config.digestSendWindowStartHour}:00-${config.digestSendWindowEndHour}:00 AZ send window — holding ${pendingEmail.length} pending listing(s) for the next in-window run.`
      );
    }
    return { scored: scoredInCoverage, emailed: 0, outOfCounty, sendSuppressed: true };
  }

  // Always send — a "0 new deals" run is itself a useful liveness signal, not
  // silence to interpret. Best-effort: scoring is already committed above, so a
  // Resend/email failure must never fail the whole run.
  try {
    await sendDigest(
      pendingEmail.map((p) => p.digest),
      { scoredCount: scoredInCoverage }
    );

    if (pendingEmail.length > 0) {
      // Send succeeded — now advance the email state for exactly what went out.
      const emailedAt = new Date().toISOString();
      const emailedRows = pendingEmail.map((p) => ({
        ...p.row,
        emailed_at: emailedAt,
        last_emailed_price: p.digest.listing.price,
      }));
      const { error: markError } = await supabase
        .from("scored_listings")
        .upsert(emailedRows, { onConflict: "listing_id" });

      if (markError) {
        throw new Error(`Digest sent but failed to record emailed state: ${markError.message}`);
      }
    }

    return { scored: scoredInCoverage, emailed: pendingEmail.length, outOfCounty };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error("Digest step failed (scoring already committed):", emailError);
    return { scored: scoredInCoverage, emailed: 0, outOfCounty, emailError };
  }
}
