-- Dedup previously keyed off a hash of comp-derived fields (margin_pct,
-- pct_below_area, arv), which drift on their own as the comp pool changes week
-- to week -- causing spurious re-sends of listings that hadn't actually
-- changed. Re-key it to the listing's own price instead: the one input that
-- represents a real, material change to the listing (e.g. a price drop).
-- See src/lib/scoreRun.ts for the dedup logic.

alter table scored_listings add column if not exists last_emailed_price numeric;

-- Backfill: for listings already emailed, assume no material change has
-- happened yet by stamping today's price, so this migration itself doesn't
-- trigger a one-time flood of re-sends.
update scored_listings sl
set last_emailed_price = cl.price
from clozers_listings cl
where cl.listing_id = sl.listing_id
  and sl.emailed_at is not null
  and sl.last_emailed_price is null;

alter table scored_listings drop column if exists last_emailed_hash;
