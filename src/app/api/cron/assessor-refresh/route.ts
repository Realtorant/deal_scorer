import { NextRequest, NextResponse } from "next/server";
import { refreshParcelCoords } from "@/lib/assessor/coords";
import { ingestAssessorComps } from "@/lib/assessor/ingest";
import { config } from "@/lib/config";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { getSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await ingestAssessorComps();

    // Best-effort coord top-up for newly-ingested parcels. Never fail the refresh
    // over the low-profile parcel feature service being unavailable — unresolved
    // parcels just use the zip fallback until a later run (or the local seed).
    let coords: { missing: number; upserted: number } | { error: string };
    try {
      coords = await refreshParcelCoords(getSupabaseClient(), config.coordMaxPerRun);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("parcel coord refresh failed (non-fatal):", message);
      coords = { error: message };
    }

    return NextResponse.json({ ok: true, summary, coords });
  } catch (err) {
    console.error("assessor-refresh failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
