import "dotenv/config";
import { writeFileSync } from "node:fs";
import { generateCompPacket } from "../src/lib/compPacket/generate";

// Generates a one-page investor comp packet PDF for a flagged listing.
//   npm run comp-packet -- <listing_id> [output.pdf]
async function main() {
  const listingId = process.argv[2];
  if (!listingId) {
    console.error("Usage: npm run comp-packet -- <listing_id> [output.pdf]");
    process.exit(1);
  }
  const outPath = process.argv[3] ?? `comp-packet-${listingId}.pdf`;

  const buffer = await generateCompPacket(listingId);
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
