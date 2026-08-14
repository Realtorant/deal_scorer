-- Radius-based comps need parcel coordinates. Coords are static per parcel and
-- come from the Assessor's Parcel Points shapefile (joined by APN), refreshed by
-- the local `npm run backfill:coords` script — kept in their own table so the
-- weekly comp ingest never clobbers them.

create table if not exists parcel_coords (
  parcel_number text primary key,
  lat double precision not null,
  long double precision not null,
  updated_at timestamptz not null default now()
);

-- Subject coordinates (from the Clozers feed) live on the listing.
alter table clozers_listings add column if not exists lat double precision;
alter table clozers_listings add column if not exists long double precision;

-- comp_source now records the ladder ("radius") or the zip fallback.
alter table scored_listings drop constraint if exists scored_listings_comp_source_check;
alter table scored_listings
  add constraint scored_listings_comp_source_check
  check (comp_source in ('radius', 'zip', 'subdivision'));

-- The comp pool the scorer loads: last-12-month SFR sales that have both a usable
-- $/sqft and a coordinate. The zip-level views (0001/0002) stay as the last-resort
-- fallback when the radius ladder can't find enough comps.
create or replace view comps_with_coords as
select
  ac.parcel_number,
  ac.zip,
  ac.livable_sqft,
  ac.price_per_sqft,
  pc.lat,
  pc.long
from assessor_comps ac
join parcel_coords pc on pc.parcel_number = ac.parcel_number
where ac.price_per_sqft is not null
  and ac.livable_sqft is not null
  and ac.sale_date >= (current_date - interval '12 months');

-- Comps in the window that still lack a coordinate — what the weekly coord
-- refresh tops up (ordered so recent sales get coords first).
create or replace view comps_missing_coords as
select ac.parcel_number, ac.sale_date
from assessor_comps ac
left join parcel_coords pc on pc.parcel_number = ac.parcel_number
where pc.parcel_number is null
  and ac.price_per_sqft is not null
  and ac.livable_sqft is not null
  and ac.sale_date >= (current_date - interval '12 months');
