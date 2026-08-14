# Setup

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, run each file in `supabase/migrations/` in order
   (`0001_init.sql`, `0002_comp_window_12mo.sql`, `0003_parcel_coords.sql`).
3. Copy the project URL and the **service role** key (Settings → API) into
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Maricopa Assessor data

The **comp backfill needs no key** — it joins two public ArcGIS bulk downloads
locally (Sales Affidavits + Residential Master), so there are no per-parcel API
calls to rate-limit.

A token *is* needed for the **live API**, used only by the on-demand parcel
lookup (`GET /api/parcel/{apn}`, authenticated with `CRON_SECRET`) for
real-time single-property checks:

1. Go to https://www.mcassessor.maricopa.gov/contact/
2. Set Subject to "API Question/Token".
3. Put the emailed token in `MARICOPA_API_TOKEN` (local `.env` + Vercel).

## 3. Resend

1. Create an account at resend.com and create an API key → `RESEND_API_KEY`.
2. Verify the sending domain **antrealestateco.com** at resend.com/domains
   (add the DNS records it gives you; wait for "Verified"). Until then, sends
   only reach your own Resend account email, from `onboarding@resend.dev`.
3. Current working config: `DIGEST_FROM_EMAIL="Deal Checker <onboarding@resend.dev>"`
   sending to `DIGEST_TO_EMAIL=anthony@antrealestateco.com`. The
   `onboarding@resend.dev` sender needs no domain verification but can *only*
   reach your Resend account-owner address (`anthony@antrealestateco.com`). Set
   both in Vercel too.
   To send the digest to any *other* address (e.g. a different inbox), verify a
   domain at resend.com/domains **in the same Resend team as the API key**, then
   switch `DIGEST_FROM_EMAIL` to an address on that domain.

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
   `MARICOPA_API_TOKEN`, `RESEND_API_KEY`, `DIGEST_TO_EMAIL`,
   `DIGEST_FROM_EMAIL`, `CRON_SECRET` (generate with `openssl rand -hex 32`).
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

## 7. Parcel coordinates (for radius comps)

Scoring picks comps by distance + size, not zip — it needs a lat/long for each
comp parcel, stored in `parcel_coords` (migration `0003`), keyed by APN. Coords
are pulled from a hosted Maricopa parcel feature service (centroid-by-APN
queries). Seed it once, **after** the assessor backfill:

```bash
npm run backfill:coords
```

After that it's automatic: the **weekly assessor cron tops up coordinates for
newly-ingested parcels** (best-effort — if the feature service is unavailable,
those parcels just use the zip fallback until the next run). Subject coordinates
come free from the Clozers feed and populate on the next scrape. No manual step
going forward.

Comp selection ladder (first tier reaching `COMP_MIN_COUNT` wins, else zip-level):
1 mi / ±15% sqft → 1.5 mi / ±15% → 1.5 mi / ±20% → zip average. Listings whose
zip is outside Maricopa coverage are filtered out of scoring and logged
minimally (a one-line console log of the distinct zips in the score run).

## 8. Tuning

`REHAB_PER_SQFT` and `BELOW_AVG_THRESHOLD` (and the margin threshold) are
explicit placeholders — see comments in `src/lib/config.ts`. Revisit them
after the first couple weeks of real digest output.
