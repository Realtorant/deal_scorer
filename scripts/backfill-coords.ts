import "dotenv/config";
import { refreshParcelCoords } from "../src/lib/assessor/coords";
import { getSupabaseClient } from "../src/lib/supabase";

// Initial full seed of parcel_coords. Repeatedly tops up comps missing a
// coordinate until no resolvable ones remain. The weekly assessor cron then
// maintains it (see src/app/api/cron/assessor-refresh). Run after
// `npm run backfill:assessor`.
async function main() {
  const supabase = getSupabaseClient();
  let total = 0;
  for (;;) {
    const { missing, upserted } = await refreshParcelCoords(supabase, 2000);
    total += upserted;
    console.log(`batch: missing=${missing} upserted=${upserted} total=${total}`);
    // Stop when nothing is left, or when a batch resolved nothing — meaning
    // what's left can't be resolved by the feature service right now. Note:
    // Supabase's PostgREST caps a page at its server-side max-rows (1000) even
    // though we ask for 2000, so `missing` alone can't signal "last page".
    if (missing === 0 || upserted === 0) break;
  }
  console.log(`done: ${total} parcel_coords upserted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
