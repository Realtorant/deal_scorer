-- Resumable-ingest checkpoint. ingestAssessorComps() upserts assessor_comps in a
-- deterministic (parcel_number-sorted) order and persists how far it got after
-- every chunk, so a run cut off by the function's time limit resumes exactly
-- where it left off on the next invocation instead of restarting from scratch —
-- guaranteeing every comp gets refreshed within a bounded number of cron runs
-- instead of the back half silently going stale forever.
create table if not exists ingest_state (
  key text primary key,
  cursor text,
  updated_at timestamptz not null default now()
);
