// Hand-written to match supabase/migrations/0001_init.sql. If the schema changes,
// update this alongside the migration (no Supabase CLI codegen wired up here).

export interface Database {
  public: {
    Tables: {
      assessor_comps: {
        Row: {
          id: number;
          parcel_number: string;
          zip: string | null;
          subdivision: string | null;
          sale_price: number;
          sale_date: string;
          livable_sqft: number | null;
          year_built: number | null;
          pool: boolean | null;
          price_per_sqft: number | null;
          raw: Record<string, unknown> | null;
          pulled_at: string;
        };
        Insert: {
          id?: number;
          parcel_number: string;
          zip?: string | null;
          subdivision?: string | null;
          sale_price: number;
          sale_date: string;
          livable_sqft?: number | null;
          year_built?: number | null;
          pool?: boolean | null;
          raw?: Record<string, unknown> | null;
          pulled_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["assessor_comps"]["Insert"]>;
        Relationships: [];
      };
      clozers_listings: {
        Row: {
          id: number;
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
          raw: Record<string, unknown> | null;
          scraped_at: string;
        };
        Insert: {
          id?: number;
          listing_id: string;
          address: string;
          price: number;
          beds?: number | null;
          baths?: number | null;
          sqft?: number | null;
          zip?: string | null;
          subdivision?: string | null;
          posted_date?: string | null;
          url: string;
          raw?: Record<string, unknown> | null;
          scraped_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clozers_listings"]["Insert"]>;
        Relationships: [];
      };
      scored_listings: {
        Row: {
          id: number;
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
          first_scored_at: string;
          last_scored_at: string;
          emailed_at: string | null;
          last_emailed_hash: string | null;
        };
        Insert: {
          id?: number;
          listing_id: string;
          comp_source?: "subdivision" | "zip" | null;
          area_price_per_sqft?: number | null;
          list_price_per_sqft?: number | null;
          pct_below_area?: number | null;
          arv?: number | null;
          rehab_estimate?: number | null;
          margin_pct?: number | null;
          comp_count?: number | null;
          flagged?: boolean;
          flag_reason?: string | null;
          first_scored_at?: string;
          last_scored_at?: string;
          emailed_at?: string | null;
          last_emailed_hash?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["scored_listings"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      comp_averages_by_zip: {
        Row: {
          zip: string | null;
          avg_price_per_sqft: number | null;
          comp_count: number | null;
          most_recent_sale: string | null;
        };
        Relationships: [];
      };
      comp_averages_by_subdivision: {
        Row: {
          subdivision: string | null;
          avg_price_per_sqft: number | null;
          comp_count: number | null;
          most_recent_sale: string | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
  };
}
