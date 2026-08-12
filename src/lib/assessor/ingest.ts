import { config } from "../config";
import { getSupabaseClient } from "../supabase";
import { streamResidentialMaster, streamSalesAffidavits } from "./download";
import { parseAffidavits, type AffidavitRow } from "./parseAffidavits";
import { buildResidentialCharsMap } from "./parseResidentialMaster";

export interface IngestSummary {
  candidatesInWindow: number;
  matchedResidential: number;
  unmatched: number;
  upserted: number;
}

const UPSERT_CHUNK = 1000;

function monthsAgoIsoDate(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Seeds/refreshes assessor_comps by joining two bulk Assessor files locally:
 *   Sales Affidavits (arm's-length SFR sales in the window) x Residential Master
 *   (livable sqft / year built / pool per parcel).
 * No per-parcel API calls — the API is rate-limited and can't sustain the volume.
 * Subdivision isn't carried by either file (and Clozers listings have no
 * subdivision anyway, so scoring runs at zip level); it stays null.
 */
export async function ingestAssessorComps(): Promise<IngestSummary> {
  const supabase = getSupabaseClient();
  const sinceIsoDate = monthsAgoIsoDate(config.assessorLookbackMonths);

  // Pass 1 — sales affidavits → comp candidates (one row per parcel).
  const affidavitStream = await streamSalesAffidavits();
  const candidates = new Map<string, AffidavitRow>();
  for await (const row of parseAffidavits(affidavitStream, { sinceIsoDate })) {
    const existing = candidates.get(row.parcelNumber);
    if (!existing || row.saleDate > existing.saleDate) {
      candidates.set(row.parcelNumber, row);
    }
  }

  // Pass 2 — residential master → characteristics, only for candidate parcels.
  const residentialStream = await streamResidentialMaster();
  const chars = await buildResidentialCharsMap(
    residentialStream,
    new Set(candidates.keys())
  );

  // Join and upsert.
  const now = new Date().toISOString();
  let matchedResidential = 0;
  const upsertRows = Array.from(candidates.values()).map((row) => {
    const c = chars.get(row.parcelNumber);
    if (c) matchedResidential += 1;
    return {
      parcel_number: row.parcelNumber,
      zip: row.situsZip,
      subdivision: null,
      sale_price: row.salePrice,
      sale_date: row.saleDate,
      livable_sqft: c?.livableSqft ?? null,
      year_built: c?.yearBuilt ?? null,
      pool: c?.pool ?? null,
      raw: { affidavit: row },
      pulled_at: now,
    };
  });

  let upserted = 0;
  for (let i = 0; i < upsertRows.length; i += UPSERT_CHUNK) {
    const chunk = upsertRows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("assessor_comps")
      .upsert(chunk, { onConflict: "parcel_number" });
    if (error) throw new Error(`Failed to upsert assessor_comps: ${error.message}`);
    upserted += chunk.length;
  }

  return {
    candidatesInWindow: candidates.size,
    matchedResidential,
    unmatched: candidates.size - matchedResidential,
    upserted,
  };
}
