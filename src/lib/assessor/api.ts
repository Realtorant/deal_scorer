// Live Maricopa Assessor API — used for on-demand / real-time single-property
// checks (NOT the bulk comp backfill, which joins bulk files locally to avoid
// this endpoint's rate limits). Served from mcassessor.maricopa.gov (the api.*
// host in the original spec resolves but refuses HTTPS connections). A single
// /parcel/{apn} call returns SubdivisionName at the top level plus building
// characteristics nested under ResidentialPropertyData.
const API_BASE = "https://mcassessor.maricopa.gov";

export interface ParcelEnrichment {
  livableSqft: number | null;
  yearBuilt: number | null;
  pool: boolean | null;
  subdivision: string | null;
  raw: Record<string, unknown>;
}

function requireToken(): string {
  const token = process.env.MARICOPA_API_TOKEN;
  if (!token) {
    throw new Error("MARICOPA_API_TOKEN is not set.");
  }
  return token;
}

// The API can occasionally slow-walk responses (especially under throttling);
// fail fast rather than hang an on-demand request.
const API_TIMEOUT_MS = 15000;

async function callApi(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      // Header names/values per MC-Assessor-API-Documentation.pdf: custom
      // AUTHORIZATION header with the token, user-agent set to null.
      AUTHORIZATION: requireToken(),
      "user-agent": "null",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Maricopa Assessor API ${path} failed: ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (/^(y|yes|true)$/i.test(value)) return true;
      if (/^(n|no|false|none|0)$/i.test(value)) return false;
    }
    if (typeof value === "number") return value > 0;
  }
  return null;
}

/**
 * Fetches live characteristics for a single parcel. Returns null if the APN
 * isn't found. The full raw response is included for callers that need more
 * than the extracted fields.
 */
export async function getParcelEnrichment(apn: string): Promise<ParcelEnrichment | null> {
  const parcel = await callApi(`/parcel/${encodeURIComponent(apn)}`);
  if (!parcel) return null;

  const residential =
    (parcel.ResidentialPropertyData as Record<string, unknown> | undefined) ?? {};

  return {
    // Field names confirmed against live responses (LivableSpace/ConstructionYear
    // come back as numeric strings; Pool is a boolean or pool square footage).
    livableSqft: pickNumber(residential, ["LivableSpace", "Detached_Livable_sqft"]),
    yearBuilt: pickNumber(residential, ["ConstructionYear", "OriginalConstructionYear"]),
    pool: pickBoolean(residential, ["Pool"]),
    subdivision: pickString(parcel, ["SubdivisionName"]),
    raw: parcel,
  };
}
