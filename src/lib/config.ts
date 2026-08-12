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

  // Minimum comp count required before trusting subdivision-level comps
  // over the zip-level fallback.
  minSubdivisionComps: envNumber("MIN_SUBDIVISION_COMPS", 3),

  // Trailing window, in months, used by the comp_averages view.
  assessorLookbackMonths: envNumber("ASSESSOR_LOOKBACK_MONTHS", 12),

  // Sales affidavits are filtered down to this window before joining against the
  // Residential Master file, so a full-history file doesn't become a full-history
  // comp set. Wider than assessorLookbackMonths on purpose, as a buffer.
  assessorIngestWindowMonths: envNumber("ASSESSOR_INGEST_WINDOW_MONTHS", 24),

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
