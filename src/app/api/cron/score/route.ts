import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { sendDigest, type DigestRow } from "@/lib/email";
import { hashScoredListing } from "@/lib/scoreHash";
import type { CompLookup } from "@/lib/scoring";
import { scoreListing } from "@/lib/scoring";
import { getSupabaseClient } from "@/lib/supabase";
import type { AreaComp, ClozersListing, ScoredListing } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

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

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
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
      return NextResponse.json({ ok: true, summary: { scored: 0, emailed: 0 } });
    }

    const listingIds = listings.map((l) => l.listing_id);
    const { data: existingScores, error: existingError } = await supabase
      .from("scored_listings")
      .select("*")
      .in("listing_id", listingIds);

    if (existingError) {
      throw new Error(`Failed to load existing scored_listings: ${existingError.message}`);
    }

    const existingByListingId = new Map((existingScores ?? []).map((row) => [row.listing_id, row]));

    const now = new Date().toISOString();
    const digestRows: DigestRow[] = [];
    const upsertRows = listings.map((listing) => {
      const scored = scoreListing(listing, compLookup);
      const hash = hashScoredListing(scored);
      const existing = existingByListingId.get(listing.listing_id);

      const shouldEmail =
        scored.flagged && (!existing?.emailed_at || existing.last_emailed_hash !== hash);
      if (shouldEmail) {
        digestRows.push({ listing, scored });
      }

      return {
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
        emailed_at: shouldEmail ? now : (existing?.emailed_at ?? null),
        last_emailed_hash: shouldEmail ? hash : (existing?.last_emailed_hash ?? null),
      };
    });

    const { error: upsertError } = await supabase
      .from("scored_listings")
      .upsert(upsertRows, { onConflict: "listing_id" });

    if (upsertError) {
      throw new Error(`Failed to upsert scored_listings: ${upsertError.message}`);
    }

    if (digestRows.length > 0) {
      await sendDigest(digestRows);
    }

    return NextResponse.json({
      ok: true,
      summary: { scored: listings.length, emailed: digestRows.length },
    });
  } catch (err) {
    console.error("score cron failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
