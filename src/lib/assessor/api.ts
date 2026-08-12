// Confirmed live: the API is served from mcassessor.maricopa.gov (the api.* host
// in the original spec resolves but refuses HTTPS connections). A single
// /parcel/{apn} call returns everything we need — SubdivisionName at the top level
// and building characteristics nested under ResidentialPropertyData.
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

async function callApi(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      // Header names/values per MC-Assessor-API-Documentation.pdf: custom
      // AUTHORIZATION header with the token, user-agent set to null.
      AUTHORIZATION: requireToken(),
      "user-agent": "null",
    },
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

export async function getParcelEnrichment(apn: string): Promise<ParcelEnrichment> {
  const parcel = (await callApi(`/parcel/${encodeURIComponent(apn)}`)) ?? {};

  const residential =
    (parcel.ResidentialPropertyData as Record<string, unknown> | undefined) ?? {};

  return {
    // Field names confirmed against live responses (LivableSpace/ConstructionYear
    // come back as numeric strings; Pool is a real boolean).
    livableSqft: pickNumber(residential, ["LivableSpace", "Detached_Livable_sqft"]),
    yearBuilt: pickNumber(residential, ["ConstructionYear", "OriginalConstructionYear"]),
    pool: pickBoolean(residential, ["Pool"]),
    subdivision: pickString(parcel, ["SubdivisionName"]),
    raw: parcel,
  };
}
