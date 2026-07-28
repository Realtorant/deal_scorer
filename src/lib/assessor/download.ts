import { Readable } from "node:stream";
import unzipper from "unzipper";

// Confirmed via https://www.mcassessor.maricopa.gov/page/data_sales/ -> ArcGIS Open Data item
// "Sales_Affidavits.zip" (item id f3484c72a938497286adc4e5de7e9963). This is a stable,
// unauthenticated, public ArcGIS content URL — no scraping or token required. Updated weekly.
const SALES_AFFIDAVITS_URL =
  "https://www.arcgis.com/sharing/rest/content/items/f3484c72a938497286adc4e5de7e9963/data";

const DATA_ENTRY_PATH = "Data/Sales_Affidavits.txt";

/**
 * Streams the Sales Affidavits ZIP and returns a readable stream of the pipe-delimited
 * data file inside it, without buffering the ~60MB zip / ~270MB uncompressed text in memory.
 */
export async function streamSalesAffidavits(): Promise<NodeJS.ReadableStream> {
  const response = await fetch(SALES_AFFIDAVITS_URL);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download Sales Affidavits ZIP: ${response.status} ${response.statusText}`
    );
  }

  const zipStream = Readable.fromWeb(
    response.body as unknown as import("stream/web").ReadableStream
  );

  return new Promise((resolve, reject) => {
    zipStream
      .pipe(unzipper.Parse())
      .on("entry", (entry: unzipper.Entry) => {
        if (entry.path === DATA_ENTRY_PATH) {
          resolve(entry);
        } else {
          entry.autodrain();
        }
      })
      .on("error", reject);
  });
}
