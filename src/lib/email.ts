import { Resend } from "resend";
import type { ClozersListing, ScoredListing } from "./types";

export interface DigestRow {
  listing: ClozersListing;
  scored: ScoredListing;
}

export interface DigestContext {
  // Total in-coverage listings scored this run — included even on a quiet run
  // so the email is a genuine liveness signal, not just a bare "nothing here".
  scoredCount: number;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null) => (value === null ? "—" : currency.format(value));
const perSqft = (value: number | null) => (value === null ? "—" : `$${value.toFixed(0)}/sqft`);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_TO_EMAIL;
  if (!apiKey || !to) {
    throw new Error("RESEND_API_KEY and DIGEST_TO_EMAIL must be set to send email.");
  }
  return {
    resend: new Resend(apiKey),
    from: process.env.DIGEST_FROM_EMAIL || "Deal Checker <onboarding@resend.dev>",
    to,
  };
}

// A transient Resend blip is the one failure mode with no fallback channel
// (the alert channel IS Resend), so it's worth one retry before giving up.
async function sendWithRetry(params: {
  resend: Resend;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const { resend, ...email } = params;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await resend.emails.send(email);
    if (!error) return;
    if (attempt === 1) throw new Error(`Resend send failed: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

// Ranking for the "top picks" highlight and the full list's order: margin %
// is the single most decision-relevant number here — it already folds ARV,
// rehab cost, and list price together into one bottom-line profitability
// figure, unlike pct_below_area which is just a raw pricing signal. Every
// flagged row has a non-null margin_pct (scoring only flags a listing once it
// has a valid area comp), so this sort never has to handle nulls in practice.
function byMarginDesc(a: DigestRow, b: DigestRow): number {
  return (b.scored.margin_pct ?? -Infinity) - (a.scored.margin_pct ?? -Infinity);
}

function digestRowHtml({ listing, scored }: DigestRow): string {
  return `
        <tr>
          <td><a href="${escapeHtml(listing.url)}">${escapeHtml(listing.address)}</a></td>
          <td>${money(listing.price)}</td>
          <td>${perSqft(scored.list_price_per_sqft)} vs ${perSqft(scored.area_price_per_sqft)}</td>
          <td>${money(scored.arv)}</td>
          <td>${money(scored.rehab_estimate)}</td>
          <td>${pct(scored.margin_pct)}</td>
          <td>${scored.comp_count ?? "—"} (${scored.comp_source ?? "n/a"})</td>
          <td>${escapeHtml(scored.flag_reason ?? "")}</td>
        </tr>`;
}

function topPickCardHtml({ listing, scored }: DigestRow, rank: number): string {
  return `
      <div style="border:1px solid #ddd; border-left:4px solid #2e7d32; border-radius:4px; padding:12px 16px; margin-bottom:10px;">
        <div style="font-weight:bold; font-size:1.05em;">
          #${rank} — <a href="${escapeHtml(listing.url)}">${escapeHtml(listing.address)}</a>
        </div>
        <div style="color:#333; margin-top:4px;">
          ${money(listing.price)} · Margin ${pct(scored.margin_pct)} ·
          ${perSqft(scored.list_price_per_sqft)} vs area ${perSqft(scored.area_price_per_sqft)}
        </div>
        <div style="color:#666; font-size:0.9em; margin-top:2px;">${escapeHtml(scored.flag_reason ?? "")}</div>
      </div>`;
}

export function buildDigestHtml(rows: DigestRow[], context: DigestContext): string {
  if (rows.length === 0) {
    const checkedAt = new Date().toUTCString();
    return `
      <div style="font-family: -apple-system, Helvetica, Arial, sans-serif;">
        <h2>Deal Checker — checked, no new deals</h2>
        <p>Checked at ${checkedAt}. Scored ${context.scoredCount} listing${
          context.scoredCount === 1 ? "" : "s"
        } this run; none met the flag threshold, or nothing changed since the last alert.</p>
      </div>`;
  }

  const ranked = [...rows].sort(byMarginDesc);
  const topPicks = ranked.slice(0, 3);
  const topPicksHtml =
    topPicks.length > 0
      ? `
      <h3 style="margin-bottom:8px;">🏆 Top ${topPicks.length} by margin</h3>
      ${topPicks.map((row, i) => topPickCardHtml(row, i + 1)).join("")}
      <hr style="margin:20px 0; border:none; border-top:1px solid #ddd;" />`
      : "";

  const tableRows = ranked.map(digestRowHtml).join("");

  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif;">
      <h2>Deal Checker — ${rows.length} new/changed flagged listing${rows.length === 1 ? "" : "s"}</h2>
      ${topPicksHtml}
      <table cellpadding="8" style="border-collapse: collapse; width: 100%;" border="1">
        <thead>
          <tr>
            <th>Address</th>
            <th>List Price</th>
            <th>List $/sqft vs Area</th>
            <th>Est. ARV</th>
            <th>Rehab Est.</th>
            <th>Margin %</th>
            <th>Comp Count</th>
            <th>Flag Reason</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

/** Always sends — a quiet run is a liveness signal too, not silence to interpret. */
export async function sendDigest(rows: DigestRow[], context: DigestContext): Promise<void> {
  const { resend, from, to } = getResendConfig();
  const subject =
    rows.length === 0
      ? `Deal Checker: checked, no new deals (${context.scoredCount} scored)`
      : `Deal Checker: ${rows.length} flagged listing${rows.length === 1 ? "" : "s"}`;

  await sendWithRetry({ resend, from, to, subject, html: buildDigestHtml(rows, context) });
}

/**
 * Alerts on a run that failed before it could even reach the digest step (e.g.
 * a Supabase read/write error). The one failure mode this can't cover is Resend
 * itself being down — there's no fallback channel for that, so scoreRun just
 * logs it to the function's console output instead.
 */
export async function sendFailureAlert(errorMessage: string): Promise<void> {
  const { resend, from, to } = getResendConfig();
  const checkedAt = new Date().toUTCString();
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif;">
      <h2 style="color:#b00020;">Deal Checker — run failed</h2>
      <p>Failed at ${checkedAt}, before scoring/digest could complete.</p>
      <pre style="white-space: pre-wrap; background:#f5f5f5; padding:12px; border-radius:4px;">${escapeHtml(errorMessage)}</pre>
    </div>`;

  await sendWithRetry({ resend, from, to, subject: "Deal Checker: run FAILED", html });
}
