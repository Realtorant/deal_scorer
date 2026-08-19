import { renderToBuffer } from "@react-pdf/renderer";
import { buildCompPacketData } from "./data";
import { CompPacketDocument } from "./render";

/** Builds a one-page investor comp packet PDF for a flagged Deal Scorer listing. */
export async function generateCompPacket(listingId: string): Promise<Buffer> {
  const data = await buildCompPacketData(listingId);
  return renderToBuffer(CompPacketDocument({ data }));
}
