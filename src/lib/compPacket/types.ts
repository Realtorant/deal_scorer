export interface PacketSoldComp {
  address: string;
  sqft: number | null;
  yearBuilt: number | null;
  pool: boolean | null;
  salePrice: number;
  pricePerSqft: number | null;
  saleDate: string; // ISO date, month precision (Assessor data source)
  distanceMi: number | null; // null for the zip-fallback comp set
}

export interface PacketScenario {
  label: "TARGET";
  headline: string; // e.g. "$394K ARV"
  arv: number;
  rehab: number;
  purchase: number;
  profit: number;
  marginPct: number;
}

export interface CompPacketData {
  generatedAt: Date;
  listingId: string;
  subject: {
    address: string;
    zip: string | null;
    sqft: number;
    listPrice: number;
    url: string;
  };
  compSource: "radius" | "zip";
  tierLabel: string; // e.g. "1 MILE RADIUS · ±15% SQFT" or "ZIP AVERAGE · 85254"
  soldComps: PacketSoldComp[];
  statBand: {
    listPrice: number;
    listPricePerSqft: number;
    areaPricePerSqft: number;
    arv: number;
    marginPct: number;
    compCount: number;
  };
  scenarios: {
    target: PacketScenario;
  };
  calloutText: string;
}
