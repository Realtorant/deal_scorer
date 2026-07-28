import { config } from "../config";
import { mapWithConcurrency } from "../concurrency";
import { getSupabaseClient } from "../supabase";
import { getParcelEnrichment } from "./api";
import { streamSalesAffidavits } from "./download";
import { parseAffidavits, type AffidavitRow } from "./parseAffidavits";

export interface IngestSummary {
  candidatesInWindow: number;
  alreadyUpToDate: number;
  enriched: number;
  enrichFailed: number;
  upserted: number;
}

function monthsAgoIsoDate(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export async function ingestAssessorComps(): Promise<IngestSummary> {
  const supabase = getSupabaseClient();

  const sinceIsoDate = monthsAgoIsoDate(config.assessorIngestWindowMonths);
  const stream = await streamSalesAffidavits();

  const candidates = new Map<string, AffidavitRow>();
  for await (const row of parseAffidavits(stream, { sinceIsoDate })) {
    // The file is "last recorded sale" per parcel already, but guard against
    // duplicate lines by keeping the most recent sale per parcel number.
    const existing = candidates.get(row.parcelNumber);
    if (!existing || row.saleDate > existing.saleDate) {
      candidates.set(row.parcelNumber, row);
    }
  }

  const candidateList = Array.from(candidates.values());

  // Skip parcels already enriched with an unchanged sale — avoids re-hitting the
  // Assessor API for comps we already have.
  const parcelNumbers = candidateList.map((c) => c.parcelNumber);
  const upToDate = new Set<string>();

  const CHUNK = 500;
  for (let i = 0; i < parcelNumbers.length; i += CHUNK) {
    const chunk = parcelNumbers.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("assessor_comps")
      .select("parcel_number, sale_date, sale_price, livable_sqft")
      .in("parcel_number", chunk);

    if (error) throw new Error(`Failed to check existing comps: ${error.message}`);

    for (const row of data ?? []) {
      const candidate = candidates.get(row.parcel_number as string);
      if (
        candidate &&
        row.livable_sqft !== null &&
        row.sale_date === candidate.saleDate &&
        Number(row.sale_price) === candidate.salePrice
      ) {
        upToDate.add(row.parcel_number as string);
      }
    }
  }

  const needsEnrichment = candidateList
    .filter((c) => !upToDate.has(c.parcelNumber))
    .sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1))
    .slice(0, config.assessorMaxEnrichPerRun);

  let enrichFailed = 0;
  const enriched = await mapWithConcurrency(
    needsEnrichment,
    config.assessorApiConcurrency,
    async (row) => {
      try {
        const enrichment = await getParcelEnrichment(row.parcelNumber);
        return { row, enrichment };
      } catch (err) {
        enrichFailed += 1;
        console.error(`Enrichment failed for parcel ${row.parcelNumber}:`, err);
        return null;
      }
    }
  );

  const upsertRows = enriched
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map(({ row, enrichment }) => ({
      parcel_number: row.parcelNumber,
      zip: row.situsZip,
      subdivision: enrichment.subdivision,
      sale_price: row.salePrice,
      sale_date: row.saleDate,
      livable_sqft: enrichment.livableSqft,
      year_built: enrichment.yearBuilt,
      pool: enrichment.pool,
      raw: { affidavit: row, enrichment: enrichment.raw },
      pulled_at: new Date().toISOString(),
    }));

  let upserted = 0;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const chunk = upsertRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("assessor_comps")
      .upsert(chunk, { onConflict: "parcel_number" });
    if (error) throw new Error(`Failed to upsert assessor_comps: ${error.message}`);
    upserted += chunk.length;
  }

  return {
    candidatesInWindow: candidateList.length,
    alreadyUpToDate: upToDate.size,
    enriched: upsertRows.length,
    enrichFailed,
    upserted,
  };
}
