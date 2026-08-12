-- Narrow the comp averaging window from 24 to 12 months.
-- Keep in sync with config.assessorLookbackMonths (ASSESSOR_LOOKBACK_MONTHS).

create or replace view comp_averages_by_zip as
select
  zip,
  avg(price_per_sqft) as avg_price_per_sqft,
  count(*) as comp_count,
  max(sale_date) as most_recent_sale
from assessor_comps
where zip is not null
  and price_per_sqft is not null
  and sale_date >= (current_date - interval '12 months')
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
  and sale_date >= (current_date - interval '12 months')
group by subdivision;
