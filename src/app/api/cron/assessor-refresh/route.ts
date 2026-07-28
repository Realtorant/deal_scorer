import { NextRequest, NextResponse } from "next/server";
import { ingestAssessorComps } from "@/lib/assessor/ingest";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await ingestAssessorComps();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("assessor-refresh failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
