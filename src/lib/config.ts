function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  // PLACEHOLDER — tune after the first couple weeks of real output.
  // Flat rehab estimate per livable sqft used in the ARV margin calc.
  rehabPerSqft: envNumber("REHAB_PER_SQFT", 25),

  // PLACEHOLDER — tune after the first couple weeks of real output.
  // A listing is flagged if projected margin meets or exceeds this.
  marginThreshold: envNumber("MARGIN_THRESHOLD", 0.2),

  // PLACEHOLDER — tune after the first couple weeks of real output.
  // A listing is flagged if its list $/sqft is this far below the area average.
  belowAvgThreshold: envNumber("BELOW_AVG_THRESHOLD", 0.12),

  // Minimum comps a radius-ladder tier must find to be accepted. If no tier
  // (see COMP_LADDER in scoring.ts) reaches this, scoring falls back to the
  // zip-level average. Validated at 5 against real data (see the comp-radius
  // report): ~99% of in-county subjects resolve via distance tiers at this value.
  compMinCount: envNumber("COMP_MIN_COUNT", 5),

  // Trailing comp window, in months. The ingest filters sales affidavits to this
  // window before joining against the Residential Master file. The comp_averages
  // SQL views apply the SAME window (hardcoded, since a view can't read env) — if
  // you change this, update supabase/migrations to match (see 0002).
  assessorLookbackMonths: envNumber("ASSESSOR_LOOKBACK_MONTHS", 12),

  // Max parcels the weekly assessor cron tops up with coordinates per run
  // (matches the parcel feature service's 2000 maxRecordCount). The weekly delta
  // of new comps is far smaller; this only bounds a first run before the initial
  // `npm run backfill:coords` seed.
  coordMaxPerRun: envNumber("COORD_MAX_PER_RUN", 2000),

  // Clozers listings older than this (by scraped_at) are treated as stale/likely
  // sold and excluded from scoring, so they don't linger in the digest forever if
  // the scraper's own posted-within-7-days filter drops them from future scrapes.
  clozersActiveWindowDays: envNumber("CLOZERS_ACTIVE_WINDOW_DAYS", 10),

  // Mirrors the Spencer's List URL the spec calls out (propTypes=SFR&beds=2&posted=7).
  // Not a tuning placeholder like the scoring thresholds above — these are deal
  // sourcing criteria; change them if the target search criteria change.
  clozersMinBeds: envNumber("CLOZERS_MIN_BEDS", 2),
  clozersPostedWithinDays: envNumber("CLOZERS_POSTED_WITHIN_DAYS", 7),
};
