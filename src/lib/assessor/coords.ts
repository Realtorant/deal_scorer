import { getSupabaseClient } from "../supabase";

// A hosted, currently-maintained re-publish of the Assessor parcel dataset
// (same APN + geometry as the Parcel Points shapefile) that supports querying
// centroids by APN — which the Vercel cron can hit cheaply, unlike the 85MB
// shapefile. The live Assessor API doesn't return coordinates (Geo is null), so
// this is the only lightweight source. It's a low-profile service, so every use
// is best-effort: a failure never blocks the assessor refresh, and any parcel it
// can't resolve simply falls back to the zip-level comp average until next run.
const PARCEL_QUERY_URL =
  "https://services5.arcgis.com/VhXcHJxGesyCg9C1/arcgis/rest/services/Maricopa_parcels/FeatureServer/0/query";

// Layer maxRecordCount — the most APNs one query can return.
const QUERY_BATCH = 2000;

interface QueryFeature {
  attributes: { APN: string };
  centroid?: { x: number; y: number } | null;
}

/** Resolves APNs to WGS84 centroids, batching to the layer's record limit. */
export async function fetchCoordsForApns(
  apns: string[]
): Promise<Map<string, { lat: number; long: number }>> {
  const out = new Map<string, { lat: number; long: number }>();

  for (let i = 0; i < apns.length; i += QUERY_BATCH) {
    const chunk = apns.slice(i, i + QUERY_BATCH);
    const inList = chunk.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
    const body = new URLSearchParams({
      where: `APN IN (${inList})`,
      returnCentroid: "true",
      returnGeometry: "false",
      outFields: "APN",
      outSR: "4326",
      f: "json",
    });

    const resp = await fetch(PARCEL_QUERY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      throw new Error(`Parcel feature service query failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as { features?: QueryFeature[]; error?: unknown };
    if (data.error) {
      throw new Error(`Parcel feature service error: ${JSON.stringify(data.error)}`);
    }
    for (const f of data.features ?? []) {
      if (f.centroid && Number.isFinite(f.centroid.x) && Number.isFinite(f.centroid.y)) {
        out.set(f.attributes.APN, { lat: f.centroid.y, long: f.centroid.x });
      }
    }
  }

  return out;
}

export interface CoordRefreshSummary {
  missing: number;
  upserted: number;
}

/**
 * Tops up parcel_coords for up to `maxParcels` comps that still lack coordinates.
 * Parcels the feature service can't resolve are left for a later run (they use
 * the zip fallback meanwhile).
 */
export async function refreshParcelCoords(
  supabase: ReturnType<typeof getSupabaseClient>,
  maxParcels: number
): Promise<CoordRefreshSummary> {
  const { data, error } = await supabase
    .from("comps_missing_coords")
    .select("parcel_number")
    .order("sale_date", { ascending: false })
    .limit(maxParcels);
  if (error) throw new Error(`Failed to load comps_missing_coords: ${error.message}`);

  const apns = (data ?? [])
    .map((r) => r.parcel_number)
    .filter((a): a is string => a !== null);
  if (apns.length === 0) return { missing: 0, upserted: 0 };

  const coords = await fetchCoordsForApns(apns);
  const now = new Date().toISOString();
  const rows = [...coords.entries()].map(([parcel_number, c]) => ({
    parcel_number,
    lat: c.lat,
    long: c.long,
    updated_at: now,
  }));

  let upserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: upsertError } = await supabase
      .from("parcel_coords")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "parcel_number" });
    if (upsertError) throw new Error(`Failed to upsert parcel_coords: ${upsertError.message}`);
    upserted += Math.min(CHUNK, rows.length - i);
  }

  return { missing: apns.length, upserted };
}
