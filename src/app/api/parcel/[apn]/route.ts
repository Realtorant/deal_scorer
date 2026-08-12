import { NextRequest, NextResponse } from "next/server";
import { getParcelEnrichment } from "@/lib/assessor/api";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 30;

// On-demand / real-time single-parcel lookup against the live Maricopa Assessor
// API. Authenticated with the same bearer secret as the cron routes so it can't
// be used to anonymously burn the API token's rate budget.
export async function GET(
  request: NextRequest,
  { params }: { params: { apn: string } }
) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const enrichment = await getParcelEnrichment(params.apn);
    if (!enrichment) {
      return NextResponse.json({ error: "parcel not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, apn: params.apn, parcel: enrichment });
  } catch (err) {
    console.error(`parcel lookup failed for ${params.apn}:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
