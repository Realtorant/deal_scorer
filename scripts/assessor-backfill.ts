import "dotenv/config";
import { ingestAssessorComps } from "../src/lib/assessor/ingest";

// Runs the Assessor ingest repeatedly until nothing new is enriched. Each pass
// re-downloads + re-parses the sales file, then enriches up to
// ASSESSOR_MAX_ENRICH_PER_RUN parcels. For the initial backfill, set that env
// var high (e.g. 200000) so a single pass drains the whole window; the loop is
// mainly so an interrupted run can be resumed by just running this again
// (already-enriched parcels are skipped).
const MAX_PASSES = Number(process.env.BACKFILL_MAX_PASSES ?? 10);

async function main() {
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n=== Pass ${pass}: downloading, parsing, enriching… ===`);
    const summary = await ingestAssessorComps();
    console.log(summary);

    if (summary.enriched === 0) {
      console.log("\n✅ Nothing new to enrich — backfill complete.");
      if (summary.enrichFailed > 0) {
        console.log(`⚠️  ${summary.enrichFailed} parcels failed enrichment this pass (see logs above).`);
      }
      return;
    }
  }
  console.log(`\nReached MAX_PASSES (${MAX_PASSES}). Re-run if more remain.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
