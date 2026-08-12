import { Readable } from "node:stream";
import unzipper from "unzipper";

// Public ArcGIS Open Data items published by the Maricopa Assessor. Both are
// stable, unauthenticated content URLs — a straight ZIP download, no token,
// no scraping. Confirmed via https://www.mcassessor.maricopa.gov/page/data_sales/.
const SALES_AFFIDAVITS_ITEM = "f3484c72a938497286adc4e5de7e9963"; // updated weekly
const RESIDENTIAL_MASTER_ITEM = "e22983d41d91490d90965544b718a120"; // updated twice a month

function itemDataUrl(itemId: string): string {
  return `https://www.arcgis.com/sharing/rest/content/items/${itemId}/data`;
}

/**
 * Streams an ArcGIS "CSV Collection" ZIP and resolves to a readable stream of the
 * named pipe-delimited entry inside it, without buffering the whole (60MB zip /
 * hundreds-of-MB uncompressed) file in memory.
 */
async function streamArcgisZipEntry(
  itemId: string,
  entryPath: string
): Promise<NodeJS.ReadableStream> {
  const response = await fetch(itemDataUrl(itemId));
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download ArcGIS item ${itemId}: ${response.status} ${response.statusText}`
    );
  }

  const zipStream = Readable.fromWeb(
    response.body as unknown as import("stream/web").ReadableStream
  );

  return new Promise((resolve, reject) => {
    zipStream
      .pipe(unzipper.Parse())
      .on("entry", (entry: unzipper.Entry) => {
        if (entry.path === entryPath) {
          resolve(entry);
        } else {
          entry.autodrain();
        }
      })
      .on("error", reject);
  });
}

export function streamSalesAffidavits(): Promise<NodeJS.ReadableStream> {
  return streamArcgisZipEntry(SALES_AFFIDAVITS_ITEM, "Data/Sales_Affidavits.txt");
}

export function streamResidentialMaster(): Promise<NodeJS.ReadableStream> {
  return streamArcgisZipEntry(RESIDENTIAL_MASTER_ITEM, "Data/Residential_Master.txt");
}
