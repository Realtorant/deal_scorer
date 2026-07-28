import { createInterface } from "node:readline";

// Column layout confirmed against a live download of Sales_Affidavits.zip
// (see "Sales Affidavits - File Spec.pdf" bundled in the ZIP, revised 10/05/2023)
// and the actual pipe-delimited header row.
const COLUMNS = [
  "PARCELNUMBER",
  "SALEDATE_MMYYYY",
  "SALEPRICE",
  "DEEDNUMBER",
  "DEEDDATE_MMDDYYYY",
  "DEEDSTATUS",
  "DEEDTYPE",
  "PROPERTYTYPECODE",
  "PROPERTYTYPEDESCRIPTION",
  "PROPERTYTYPEOTHERDESCRIPTION",
  "SITUSADDRESS",
  "SITUSSUITE",
  "SITUSCITY",
  "SITUSZIP",
  "GRANTOROWNERNAME",
  "GRANTORADDRESSLINE1",
  "GRANTORADDRESSLINE2",
  "GRANTORCITY",
  "GRANTORSTATE",
  "GRANTORZIP",
  "GRANTORCOUNTRY",
  "GRANTEEOWNERNAME",
  "GRANTEEADDRESSLINE1",
  "GRANTEEADDRESSLINE2",
  "GRANTEECITY",
  "GRANTEESTATE",
  "GRANTEEZIP",
  "GRANTEECOUNTRY",
  "FINANCETYPECODE",
  "FINANCETYPEOTHERDESCRIPTION",
  "DOWNPAYMENT",
  "PARTIALINTERESTINDICATOR",
  "PARTIALINTERESTPERCENT",
  "PARTIALINTERESTDESCRIPTION",
  "MULTIPARCELINDICATOR",
  "NUMBEROFPARCELS",
  "BUY_SELLRELATIONSHIPINDICATOR",
  "BUY_SELLRELATIONSHIP",
  "OWNEROCCUPANCYINDICATOR",
  "ASSESSORCODE",
  "ASSESSORCODEDESCRIPTION",
  "PERSONALPROPERTYINDICATOR",
  "PERSONALPROPERTYVALUE",
  "PERSONALPROPERTYDESCRIPTION",
] as const;

export interface AffidavitRow {
  parcelNumber: string;
  saleDate: string; // ISO date, first-of-month (file only carries MM/YYYY precision)
  salePrice: number;
  situsAddress: string;
  situsCity: string;
  situsZip: string | null;
}

export interface ParseAffidavitsOptions {
  /** Only rows with sale_date on/after this ISO date are yielded. */
  sinceIsoDate: string;
}

function parseSaleDateMMYYYY(value: string): string | null {
  if (value.length !== 6) return null;
  const month = value.slice(0, 2);
  const year = value.slice(2, 6);
  if (!/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  return `${year}-${month}-01`;
}

/**
 * Streams and filters the pipe-delimited Sales Affidavits file down to arm's-length,
 * single-parcel, single-family-residential sales within the lookback window — the only
 * rows worth turning into comps. Filter rationale:
 *  - PARTIALINTERESTINDICATOR = 'N': partial-interest sales don't reflect full market value.
 *  - MULTIPARCELINDICATOR = 'N': a multi-parcel sale price doesn't isolate one parcel's value.
 *  - BUY_SELLRELATIONSHIPINDICATOR != 'Y': excludes related-party (non-arm's-length) transfers.
 *  - SALEPRICE > 0.
 */
export async function* parseAffidavits(
  stream: NodeJS.ReadableStream,
  options: ParseAffidavitsOptions
): AsyncGenerator<AffidavitRow> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let isFirstLine = true;
  let headerIndex: Record<string, number> = {};

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false;
      const header = line.split("|");
      headerIndex = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
      continue;
    }
    if (!line) continue;

    const fields = line.split("|");
    const get = (col: (typeof COLUMNS)[number]) => fields[headerIndex[col] ?? -1] ?? "";

    const propertyType = get("PROPERTYTYPEDESCRIPTION");
    if (!propertyType.toLowerCase().startsWith("single family")) continue;

    const partialInterest = get("PARTIALINTERESTINDICATOR");
    if (partialInterest === "Y") continue;

    const multiParcel = get("MULTIPARCELINDICATOR");
    if (multiParcel === "Y") continue;

    const relatedParty = get("BUY_SELLRELATIONSHIPINDICATOR");
    if (relatedParty === "Y") continue;

    const salePrice = Number(get("SALEPRICE"));
    if (!Number.isFinite(salePrice) || salePrice <= 0) continue;

    const saleDate = parseSaleDateMMYYYY(get("SALEDATE_MMYYYY"));
    if (!saleDate || saleDate < options.sinceIsoDate) continue;

    const parcelNumber = get("PARCELNUMBER").trim();
    if (!parcelNumber) continue;

    yield {
      parcelNumber,
      saleDate,
      salePrice,
      situsAddress: get("SITUSADDRESS").trim(),
      situsCity: get("SITUSCITY").trim(),
      situsZip: get("SITUSZIP").trim().slice(0, 5) || null,
    };
  }
}
