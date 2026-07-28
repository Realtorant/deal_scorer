export interface AssessorComp {
  parcel_number: string;
  zip: string | null;
  subdivision: string | null;
  sale_price: number;
  sale_date: string; // ISO date
  livable_sqft: number | null;
  year_built: number | null;
  pool: boolean | null;
  raw?: Record<string, unknown>;
}

export interface AreaComp {
  source: "subdivision" | "zip";
  key: string;
  avgPricePerSqft: number;
  compCount: number;
}

export interface ClozersListing {
  listing_id: string;
  address: string;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  zip: string | null;
  subdivision: string | null;
  posted_date: string | null;
  url: string;
  raw?: Record<string, unknown>;
}

export interface ScoredListing {
  listing_id: string;
  comp_source: "subdivision" | "zip" | null;
  area_price_per_sqft: number | null;
  list_price_per_sqft: number | null;
  pct_below_area: number | null;
  arv: number | null;
  rehab_estimate: number | null;
  margin_pct: number | null;
  comp_count: number | null;
  flagged: boolean;
  flag_reason: string | null;
}
