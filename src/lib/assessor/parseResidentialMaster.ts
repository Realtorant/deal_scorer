import { createInterface } from "node:readline";

// The Residential Master file has NO header row (first line is data) and is
// positional. Column indices (0-based) confirmed by cross-referencing several
// parcels against the Assessor API's ResidentialPropertyData:
//   [0]  PARCEL NUMBER
//   [10] CONSTRUCTION YEAR   (e.g. "2010")
//   [11] LIVABLE SQFT        (matches API LivableSpace)
//   [18] POOL                (pool square footage; 0 / "" = no pool)
// See "R116_ResidentialMaster" file spec bundled in the ZIP.
const COL_PARCEL = 0;
const COL_YEAR_BUILT = 10;
const COL_LIVABLE_SQFT = 11;
const COL_POOL = 18;

export interface ResidentialChars {
  livableSqft: number | null;
  yearBuilt: number | null;
  pool: boolean | null;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Streams the Residential Master file and returns characteristics keyed by parcel
 * number, keeping only parcels in `wanted` so memory stays bounded to the comp
 * candidate set rather than all ~900k residential parcels.
 */
export async function buildResidentialCharsMap(
  stream: NodeJS.ReadableStream,
  wanted: Set<string>
): Promise<Map<string, ResidentialChars>> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const chars = new Map<string, ResidentialChars>();

  for await (const line of rl) {
    if (!line) continue;
    const fields = line.split("|");
    const parcel = fields[COL_PARCEL]?.trim();
    if (!parcel || !wanted.has(parcel)) continue;

    const poolRaw = fields[COL_POOL]?.trim();
    chars.set(parcel, {
      livableSqft: toNumberOrNull(fields[COL_LIVABLE_SQFT]?.trim()),
      yearBuilt: toNumberOrNull(fields[COL_YEAR_BUILT]?.trim()),
      pool: poolRaw ? Number(poolRaw) > 0 : null,
    });
  }

  return chars;
}
