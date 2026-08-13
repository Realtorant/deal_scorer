import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

// ⚠️ TEMPORARY DIAGNOSTIC — delete this route once CRON_SECRET is verified.
// It never returns the secret: only whether it's present, its length, and an
// irreversible SHA-256 of the value (safe to expose for a high-entropy secret).
export async function GET() {
  const secret = process.env.CRON_SECRET;
  return NextResponse.json({
    present: Boolean(secret),
    length: secret ? secret.length : 0,
    sha256: secret ? createHash("sha256").update(secret).digest("hex") : null,
  });
}
