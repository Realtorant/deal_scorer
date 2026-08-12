import "dotenv/config";
import { runScoreAndDigest } from "../src/lib/scoreRun";

runScoreAndDigest()
  .then((summary) => {
    console.log(summary);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
