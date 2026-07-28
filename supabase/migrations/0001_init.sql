-- Deal Checker schema: Maricopa Assessor comps + Clozers listings + scoring.

create table if not exists assessor_comps (
  id bigint generated always as identity primary key,
  parcel_number text not null unique,
  zip text,
  subdivision text,
  sale_price numeric not null,
  sale_date date not null,
  livable_sqft numeric,
  year_built integer,
  pool boolean,
  price_per_sqft numeric generated always as (
    case when livable_sqft is not null and livable_sqft > 0
      then sale_price / livable_sqft
      else null
    end
  ) stored,
  raw jsonb,
  pulled_at timestamptz not null default now()
);

create index if not exists assessor_comps_zip_idx on assessor_comps (zip);
create index if not exists assessor_comps_subdivision_idx on assessor_comps (subdivision);
create index if not exists assessor_comps_sale_date_idx on assessor_comps (sale_date);

-- Rolling trailing-window $/sqft average, computed live so it never goes stale.
-- App code (config.assessorLookbackMonths) treats the window as a placeholder
-- to tune; this view hardcodes a generous 24-month upper bound and the app
-- layer filters further so the window can change without a migration.
create or replace view comp_averages_by_zip as
select
  zip,
  avg(price_per_sqft) as avg_price_per_sqft,
  count(*) as comp_count,
  max(sale_date) as most_recent_sale
from assessor_comps
where zip is not null
  and price_per_sqft is not null
  and sale_date >= (current_date - interval '24 months')
group by zip;

create or replace view comp_averages_by_subdivision as
select
  subdivision,
  avg(price_per_sqft) as avg_price_per_sqft,
  count(*) as comp_count,
  max(sale_date) as most_recent_sale
from assessor_comps
where subdivision is not null
  and price_per_sqft is not null
  and sale_date >= (current_date - interval '24 months')
group by subdivision;

create table if not exists clozers_listings (
  id bigint generated always as identity primary key,
  listing_id text not null unique,
  address text not null,
  price numeric not null,
  beds numeric,
  baths numeric,
  sqft numeric,
  zip text,
  subdivision text,
  posted_date date,
  url text not null,
  raw jsonb,
  scraped_at timestamptz not null default now()
);

create index if not exists clozers_listings_zip_idx on clozers_listings (zip);

create table if not exists scored_listings (
  id bigint generated always as identity primary key,
  listing_id text not null unique references clozers_listings (listing_id),
  comp_source text check (comp_source in ('subdivision', 'zip')),
  area_price_per_sqft numeric,
  list_price_per_sqft numeric,
  pct_below_area numeric,
  arv numeric,
  rehab_estimate numeric,
  margin_pct numeric,
  comp_count integer,
  flagged boolean not null default false,
  flag_reason text,
  first_scored_at timestamptz not null default now(),
  last_scored_at timestamptz not null default now(),
  emailed_at timestamptz,
  last_emailed_hash text
);

create index if not exists scored_listings_flagged_idx on scored_listings (flagged);
