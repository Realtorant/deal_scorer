import "dotenv/config";
import { ingestAssessorComps } from "../src/lib/assessor/ingest";

// Seeds assessor_comps by joining the Sales Affidavits and Residential Master
// bulk files locally. No API rate limits to work around, so a single run does
// the whole window. The weekly Vercel cron runs the same ingest.
async function main() {
  console.log("Downloading + joining bulk files…");
  const summary = await ingestAssessorComps();
  console.log(summary);
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
