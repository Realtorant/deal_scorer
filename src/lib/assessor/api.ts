const API_BASE = "https://api.mcassessor.maricopa.gov";

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
      AUTHORIZATION: requireToken(),
      "user-agent": "",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Maricopa Assessor API ${path} failed: ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

// The API doc (MC-Assessor-API-Documentation.pdf) only specifies endpoint paths, not
// response field names — we don't have a token to confirm the exact JSON shape.
// These candidate keys cover the most commonly seen conventions for this API; the
// full raw response is always stored alongside so mapping can be corrected without
// re-fetching once real responses are seen (first live run against MARICOPA_API_TOKEN
// should double check these against `raw`).
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
  const propertyInfo = (await callApi(`/parcel/${encodeURIComponent(apn)}/propertyinfo`)) ?? {};

  let subdivision = pickString(propertyInfo, [
    "Subdivision",
    "SubdivisionName",
    "subdivision",
  ]);

  let raw: Record<string, unknown> = { propertyinfo: propertyInfo };

  if (!subdivision) {
    const parcelDetails = await callApi(`/parcel/${encodeURIComponent(apn)}`);
    if (parcelDetails) {
      raw = { ...raw, parcel: parcelDetails };
      subdivision = pickString(parcelDetails, [
        "Subdivision",
        "SubdivisionName",
        "subdivision",
      ]);
    }
  }

  return {
    livableSqft: pickNumber(propertyInfo, [
      "LivableSpace",
      "LivableSqft",
      "LivingArea",
      "SquareFeet",
      "sqft",
    ]),
    yearBuilt: pickNumber(propertyInfo, [
      "ConstructionYear",
      "YearBuilt",
      "yearBuilt",
    ]),
    pool: pickBoolean(propertyInfo, ["Pool", "PoolIndicator", "pool"]),
    subdivision,
    raw,
  };
}
