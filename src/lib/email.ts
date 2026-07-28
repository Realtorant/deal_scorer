import { Resend } from "resend";
import type { ClozersListing, ScoredListing } from "./types";

export interface DigestRow {
  listing: ClozersListing;
  scored: ScoredListing;
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

export function buildDigestHtml(rows: DigestRow[]): string {
  const tableRows = rows
    .map(({ listing, scored }) => {
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
    })
    .join("");

  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif;">
      <h2>Deal Checker — ${rows.length} new/changed flagged listing${rows.length === 1 ? "" : "s"}</h2>
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

export async function sendDigest(rows: DigestRow[]): Promise<void> {
  if (rows.length === 0) return;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_TO_EMAIL;
  if (!apiKey || !to) {
    throw new Error("RESEND_API_KEY and DIGEST_TO_EMAIL must be set to send the digest.");
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: process.env.DIGEST_FROM_EMAIL || "Deal Checker <onboarding@resend.dev>",
    to,
    subject: `Deal Checker: ${rows.length} flagged listing${rows.length === 1 ? "" : "s"}`,
    html: buildDigestHtml(rows),
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
