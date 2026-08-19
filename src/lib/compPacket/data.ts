import { config } from "../config";
import { loadComps, loadZipComps } from "../scoreRun";
import { haversineMiles, selectRadiusCompDetails } from "../scoring";
import { getSupabaseClient } from "../supabase";
import type { CompPacketData, PacketScenario, PacketSoldComp } from "./types";
import { money, moneyCompact, pct1 } from "./format";

// A handful of Assessor records carry literal placeholder text ("N/A", "NA")
// in SITUSADDRESS/SITUSCITY rather than leaving it blank — treat those the
// same as missing so they don't show up as junk rows in the comp table.
function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return /^n\/?a$/i.test(value.trim());
}

function extractAffidavitAddress(raw: unknown): string | null {
  const affidavit = (raw as { affidavit?: { situsAddress?: string; situsCity?: string } } | null)
    ?.affidavit;
  if (!affidavit) return null;
  const parts = [affidavit.situsAddress, affidavit.situsCity].filter((v) => !isPlaceholder(v));
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildScenario(
  label: "FLOOR" | "TARGET",
  arv: number,
  purchase: number,
  rehab: number
): PacketScenario {
  const profit = arv - purchase - rehab;
  const marginPct = arv > 0 ? profit / arv : 0;
  return {
    label,
    headline: `${moneyCompact(arv)} ARV · ${label === "FLOOR" ? "Conservative" : "Base Case"}`,
    arv,
    rehab,
    purchase,
    profit,
    marginPct,
  };
}

function buildCallout(params: {
  compSource: "radius" | "zip";
  tierDescription: string;
  soldComps: PacketSoldComp[];
  areaPricePerSqft: number;
  listPricePerSqft: number;
  pctBelowArea: number;
  arv: number;
  rehab: number;
  marginPct: number;
  compCount: number;
}): string {
  const {
    compSource,
    tierDescription,
    soldComps,
    areaPricePerSqft,
    listPricePerSqft,
    pctBelowArea,
    arv,
    rehab,
    marginPct,
    compCount,
  } = params;

  const withPpsf = soldComps.filter((c) => c.pricePerSqft !== null);
  const ppsfValues = withPpsf.map((c) => c.pricePerSqft as number);
  const rangeSentence =
    ppsfValues.length > 0
      ? `${compCount} sold comps ${tierDescription} average ${money(areaPricePerSqft)}/sqft (range ${money(
          Math.min(...ppsfValues)
        )}–${money(Math.max(...ppsfValues))}/sqft).`
      : `${compCount} sold comps ${tierDescription} average ${money(areaPricePerSqft)}/sqft.`;

  const belowOrAbove = pctBelowArea >= 0 ? "below" : "above";
  const compareSentence = `List price runs ${money(listPricePerSqft)}/sqft, ${pct1(
    Math.abs(pctBelowArea)
  )} ${belowOrAbove} that area average.`;

  const clearsOrShort = marginPct >= config.marginThreshold ? "clears" : "falls short of";
  const marginSentence = `At the target ARV of ${money(arv)}, that pencils to a ${pct1(
    marginPct
  )} margin after a ${money(rehab)} rehab estimate (${money(config.rehabPerSqft)}/sqft) — ${clearsOrShort} our ${pct1(
    config.marginThreshold
  )} flag threshold.`;

  const caveat =
    compSource === "radius"
      ? "Figures are Assessor-sourced and auto-generated — verify condition, recent updates, and true rehab scope before committing capital."
      : `Fewer than ${config.compMinCount} sold comps were found within the radius ladder, so this estimate falls back to the zip-wide average — a wider, less precise comp set. Confirm nearby closed sales manually before finalizing terms.`;

  return [rangeSentence, compareSentence, marginSentence, caveat].join(" ");
}

export async function buildCompPacketData(listingId: string): Promise<CompPacketData> {
  const supabase = getSupabaseClient();

  const [{ data: listing, error: listingError }, { data: scored, error: scoredError }] =
    await Promise.all([
      supabase.from("clozers_listings").select("*").eq("listing_id", listingId).maybeSingle(),
      supabase.from("scored_listings").select("*").eq("listing_id", listingId).maybeSingle(),
    ]);

  if (listingError) throw new Error(`Failed to load listing: ${listingError.message}`);
  if (scoredError) throw new Error(`Failed to load scored listing: ${scoredError.message}`);
  if (!listing) throw new Error(`No clozers_listings row for listing_id ${listingId}`);
  if (!scored) throw new Error(`No scored_listings row for listing_id ${listingId} — run scoring first`);
  if (!scored.flagged) {
    throw new Error(`Listing ${listingId} is not currently flagged — refusing to build a packet for it`);
  }
  if (!listing.sqft) {
    // Structurally shouldn't happen for a flagged listing (scoreListing bails
    // out and never flags one without sqft), but stay defensive.
    throw new Error(`Listing ${listingId} has no sqft on file — cannot rebuild ARV/rehab figures`);
  }

  const [comps, zipData] = await Promise.all([loadComps(supabase), loadZipComps(supabase)]);

  // Missing subject coordinates isn't fatal — same as scoring itself, it just
  // means no radius tier can match, so this falls through to the zip fallback
  // below rather than erroring.
  const details =
    listing.lat !== null && listing.long !== null
      ? selectRadiusCompDetails({ lat: listing.lat, long: listing.long, sqft: listing.sqft }, comps)
      : null;

  let soldComps: PacketSoldComp[] = [];
  let compSource: "radius" | "zip";
  let tierLabel: string;
  let tierDescription: string;
  let areaPricePerSqft: number;
  let compCount: number;

  if (details) {
    compSource = "radius";
    tierLabel = `${details.radiusMi} MILE RADIUS · ±${Math.round(details.sqftPct * 100)}% SQFT`;
    tierDescription = `within ${details.radiusMi}mi and ±${Math.round(details.sqftPct * 100)}% sqft`;
    areaPricePerSqft = details.areaComp.avgPricePerSqft;
    compCount = details.areaComp.compCount;

    const parcelNumbers = details.matchedComps.map((c) => c.parcelNumber);
    const { data: rows, error } = await supabase
      .from("assessor_comps")
      .select("parcel_number,sale_price,sale_date,livable_sqft,year_built,pool,price_per_sqft,raw")
      .in("parcel_number", parcelNumbers);
    if (error) throw new Error(`Failed to load comp detail rows: ${error.message}`);

    const byParcel = new Map((rows ?? []).map((r) => [r.parcel_number, r]));
    const distanceByParcel = new Map(
      details.matchedComps.map((c) => [
        c.parcelNumber,
        // Recompute display distance the same way scoring did (haversine).
        haversineMiles(listing.lat as number, listing.long as number, c.lat, c.long),
      ])
    );

    soldComps = parcelNumbers
      .map((pn) => {
        const r = byParcel.get(pn);
        if (!r) return null;
        const address = extractAffidavitAddress(r.raw);
        if (!address) return null; // drop rows with unusable/placeholder addresses
        const comp: PacketSoldComp = {
          address,
          sqft: r.livable_sqft,
          yearBuilt: r.year_built,
          pool: r.pool,
          salePrice: r.sale_price,
          pricePerSqft: r.price_per_sqft,
          saleDate: r.sale_date,
          distanceMi: distanceByParcel.get(pn) ?? null,
        };
        return comp;
      })
      .filter((c): c is PacketSoldComp => c !== null)
      .sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
  } else {
    // Zip fallback: no individual radius match, so pull a representative
    // sample of recent zip sales directly for the table.
    compSource = "zip";
    const zip = listing.zip ?? "unknown";
    tierLabel = `ZIP AVERAGE · ${zip}`;
    tierDescription = `in zip ${zip}`;
    const zipComp = listing.zip ? zipData.byZip.get(listing.zip) : null;
    areaPricePerSqft = zipComp?.avgPricePerSqft ?? 0;
    compCount = zipComp?.compCount ?? 0;

    if (listing.zip) {
      // Over-fetch a bit since some rows get dropped for unusable addresses.
      const { data: rows, error } = await supabase
        .from("assessor_comps")
        .select("sale_price,sale_date,livable_sqft,year_built,pool,price_per_sqft,raw")
        .eq("zip", listing.zip)
        .not("price_per_sqft", "is", null)
        .order("sale_date", { ascending: false })
        .limit(15);
      if (error) throw new Error(`Failed to load zip comp rows: ${error.message}`);

      soldComps = (rows ?? [])
        .map((r) => {
          const address = extractAffidavitAddress(r.raw);
          if (!address) return null;
          const comp: PacketSoldComp = {
            address,
            sqft: r.livable_sqft,
            yearBuilt: r.year_built,
            pool: r.pool,
            salePrice: r.sale_price,
            pricePerSqft: r.price_per_sqft,
            saleDate: r.sale_date,
            distanceMi: null,
          };
          return comp;
        })
        .filter((c): c is PacketSoldComp => c !== null)
        .slice(0, 8);
    }
  }

  const listPricePerSqft = scored.list_price_per_sqft ?? listing.price / listing.sqft;
  const arv = scored.arv ?? areaPricePerSqft * listing.sqft;
  const rehab = scored.rehab_estimate ?? config.rehabPerSqft * listing.sqft;
  const marginPct = scored.margin_pct ?? (arv - listing.price - rehab) / arv;
  const pctBelowArea = scored.pct_below_area ?? (areaPricePerSqft - listPricePerSqft) / areaPricePerSqft;

  const floorArv = arv * (1 - config.arvFloorDiscountPct);
  const target = buildScenario("TARGET", arv, listing.price, rehab);
  const floor = buildScenario("FLOOR", floorArv, listing.price, rehab);

  const calloutText = buildCallout({
    compSource,
    tierDescription,
    soldComps,
    areaPricePerSqft,
    listPricePerSqft,
    pctBelowArea,
    arv,
    rehab,
    marginPct,
    compCount,
  });

  return {
    generatedAt: new Date(),
    listingId,
    subject: {
      address: listing.address,
      zip: listing.zip,
      sqft: listing.sqft,
      listPrice: listing.price,
      url: listing.url,
    },
    compSource,
    tierLabel,
    soldComps,
    statBand: {
      listPrice: listing.price,
      listPricePerSqft,
      areaPricePerSqft,
      arv,
      marginPct,
      compCount,
    },
    scenarios: { floor, target },
    calloutText,
  };
}
