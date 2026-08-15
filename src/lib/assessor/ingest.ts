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
  // false when the time budget ran out before every candidate was upserted —
  // the next invocation resumes right after the last row this run wrote,
  // rather than restarting from the top.
  cycleComplete: boolean;
  remaining: number;
}

const UPSERT_CHUNK = 1000;
const INGEST_STATE_KEY = "assessor_comps";

type SupabaseClient = ReturnType<typeof getSupabaseClient>;
type UpsertRow = {
  parcel_number: string;
  zip: string | null;
  subdivision: null;
  sale_price: number;
  sale_date: string;
  livable_sqft: number | null;
  year_built: number | null;
  pool: boolean | null;
  raw: Record<string, unknown>;
  pulled_at: string;
};

function monthsAgoIsoDate(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function getCursor(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("ingest_state")
    .select("cursor")
    .eq("key", INGEST_STATE_KEY)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ingest_state: ${error.message}`);
  return data?.cursor ?? null;
}

async function setCursor(supabase: SupabaseClient, cursor: string | null): Promise<void> {
  const { error } = await supabase
    .from("ingest_state")
    .upsert(
      { key: INGEST_STATE_KEY, cursor, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(`Failed to persist ingest cursor: ${error.message}`);
}

/**
 * Seeds/refreshes assessor_comps by joining two bulk Assessor files locally:
 *   Sales Affidavits (arm's-length SFR sales in the window) x Residential Master
 *   (livable sqft / year built / pool per parcel).
 * No per-parcel API calls — the API is rate-limited and can't sustain the volume.
 * Subdivision isn't carried by either file (and Clozers listings have no
 * subdivision anyway, so scoring runs at zip level); it stays null.
 *
 * The upsert loop is resumable: rows are upserted in deterministic
 * parcel_number order, and the last-written parcel_number is persisted as a
 * cursor after every chunk. If the run is cut off (timeout, redeploy, etc.)
 * before finishing, the next invocation resumes right after that cursor
 * instead of re-parsing-and-restarting from the top — so a slow week can
 * never leave part of the table permanently stale.
 */
export async function ingestAssessorComps(): Promise<IngestSummary> {
  const startedAt = Date.now();
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

  // Join, then sort deterministically so a persisted cursor means the same
  // thing across invocations regardless of the bulk files' row order.
  const now = new Date().toISOString();
  let matchedResidential = 0;
  const allRows: UpsertRow[] = Array.from(candidates.values()).map((row) => {
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
  allRows.sort((a, b) => (a.parcel_number < b.parcel_number ? -1 : a.parcel_number > b.parcel_number ? 1 : 0));

  const cursor = await getCursor(supabase);
  let resumeIndex = 0;
  if (cursor) {
    const idx = allRows.findIndex((r) => r.parcel_number > cursor);
    resumeIndex = idx === -1 ? allRows.length : idx;
  }

  let upserted = 0;
  let i = resumeIndex;
  for (; i < allRows.length; i += UPSERT_CHUNK) {
    if (Date.now() - startedAt > config.assessorIngestTimeBudgetMs) break;

    const chunk = allRows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("assessor_comps")
      .upsert(chunk, { onConflict: "parcel_number" });
    if (error) throw new Error(`Failed to upsert assessor_comps: ${error.message}`);
    upserted += chunk.length;

    // Persist progress after every chunk — a hard kill mid-run still leaves a
    // correct checkpoint, not just one written at the very end.
    await setCursor(supabase, chunk[chunk.length - 1]!.parcel_number);
  }

  const cycleComplete = i >= allRows.length;
  if (cycleComplete) {
    await setCursor(supabase, null); // next run starts a fresh full cycle
  }

  return {
    candidatesInWindow: candidates.size,
    matchedResidential,
    unmatched: candidates.size - matchedResidential,
    upserted,
    cycleComplete,
    remaining: Math.max(0, allRows.length - i),
  };
}
