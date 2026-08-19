import { NextRequest, NextResponse } from "next/server";
import { generateCompPacket } from "@/lib/compPacket/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Deliberately unauthenticated — this is the URL clicked straight out of the
// digest email, by anyone who has the email, with no login and no terminal.
// The listing_id UUID is the only gate; see the comp-packet feature notes for
// the tradeoff (an unguessable link, not a secret one).
function errorPage(title: string, message: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0; background:#20211E; color:#F2F0EA; font-family:-apple-system,Helvetica,Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh;">
  <div style="max-width:420px; padding:32px; text-align:center;">
    <div style="font-size:11px; letter-spacing:1.5px; color:#C5A572; font-weight:bold; margin-bottom:16px;">DEAL CHECKER</div>
    <h1 style="font-size:18px; margin:0 0 12px;">${title}</h1>
    <p style="font-size:14px; color:#B8B6AE; line-height:1.5; margin:0;">${message}</p>
  </div>
</body>
</html>`;
}

function htmlErrorResponse(title: string, message: string, status: number): NextResponse {
  return new NextResponse(errorPage(title, message), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { listingId: string } }
) {
  const { listingId } = params;

  let pdf: Buffer;
  try {
    pdf = await generateCompPacket(listingId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`comp-packet generation failed for ${listingId}:`, message);

    // buildCompPacketData throws plain, human-readable messages for the
    // "expected" not-available cases (no row, not flagged) — surface those
    // directly since they're already written for a non-technical reader.
    // Anything else (a DB/render failure) gets a generic message instead of
    // leaking internals to a public, unauthenticated page.
    const notAvailable =
      /No clozers_listings row|No scored_listings row|is not currently flagged/.test(message);

    return htmlErrorResponse(
      "This comp packet isn't available",
      notAvailable
        ? "This listing may have sold, changed price, or dropped off the flagged list since the email was sent."
        : "Something went wrong generating this packet. Try again in a moment, or reach out if it keeps happening.",
      notAvailable ? 404 : 500
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="comp-packet-${listingId}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
