import "dotenv/config";
import { ingestClozersListings } from "../src/lib/clozers/ingest";

ingestClozersListings()
  .then((summary) => {
    console.log(summary);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
