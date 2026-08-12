# Setup

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. Copy the project URL and the **service role** key (Settings → API) into
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Maricopa Assessor data

No key needed. Enrichment joins two **public** ArcGIS bulk downloads locally —
Sales Affidavits (sale price/date per parcel) and Residential Master (livable
sqft, year built, pool) — so there are no per-parcel API calls to rate-limit.
Nothing to configure here.

## 3. Resend

1. Create an account at resend.com, verify a sending domain (or use their
   shared `onboarding@resend.dev` sender for testing).
2. Create an API key, put it in `RESEND_API_KEY`.
3. Set `DIGEST_TO_EMAIL` (defaults to anthony@antrealestateco.com in
   `.env.example`) and optionally `DIGEST_FROM_EMAIL`.

## 4. Clozers scraper (`src/lib/clozers/fetchDeals.ts`)

Spencer's List (`app.clozers.co/spencers-list`) is public, no login required.
It's backed by an **undocumented internal endpoint**,
`https://api.clozers.co/v1/spencers-deals?limit=100`, found by inspecting
Network requests on the page — confirmed working, returns up to 100
most-recent deals with address/price/beds/baths/sqft/zip/property
type/posted date. All filtering (property type, beds, posted-within-N-days)
happens client-side in the Clozers React app, not server-side, so
`scrapeClozersListings()` replicates that filtering itself using
`CLOZERS_MIN_BEDS` / `CLOZERS_POSTED_WITHIN_DAYS`.

This is not a public API contract — Clozers could change the endpoint shape
without notice. If `/api/cron/scrape-clozers` starts failing or returning
empty, re-inspect Network on the Spencer's List page for what changed; a
DOM-scrape fallback (Playwright against the rendered cards) would be the next
thing to build if the JSON endpoint goes away entirely.

Test locally: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run scrape:clozers`
and confirm rows land in `clozers_listings`.

## 5. Vercel

1. Import the repo into Vercel.
2. Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `RESEND_API_KEY`, `DIGEST_TO_EMAIL`, `DIGEST_FROM_EMAIL`, `CRON_SECRET`
   (generate with `openssl rand -hex 32`).
3. `vercel.json` already defines all three cron schedules; Vercel picks them
   up on deploy. Cron requires a Pro plan for the 300s `maxDuration` on
   `/api/cron/assessor-refresh`.

## 6. Initial Assessor backfill

The assessor-refresh ingest joins the two bulk files and upserts every SFR sale
in the window each run — idempotent, no rate limits. Seed it locally once:

```bash
npm run backfill:assessor
```

(needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`). It downloads
both ZIPs, joins them, and upserts ~100k comps in a few minutes. The weekly
Vercel cron then re-runs the same ingest to keep them fresh.

## 7. Tuning

`REHAB_PER_SQFT` and `BELOW_AVG_THRESHOLD` (and the margin threshold) are
explicit placeholders — see comments in `src/lib/config.ts`. Revisit them
after the first couple weeks of real digest output.
