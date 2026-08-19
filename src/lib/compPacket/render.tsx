import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { money, moneyCompact, pct1 } from "./format";
import type { CompPacketData, PacketScenario, PacketSoldComp } from "./types";

// Approved palette.
const COLORS = {
  bg: "#20211E",
  gold: "#C5A572",
  green: "#7FB069",
  text: "#EDEDE8",
  muted: "#9B9A93",
  border: "#3A3B37",
  cardBg: "#262720",
};

const dateShort = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

const s = StyleSheet.create({
  page: {
    backgroundColor: COLORS.bg,
    color: COLORS.text,
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 26,
    paddingHorizontal: 32,
  },
  row: { flexDirection: "row" },
  spaceBetween: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 7, letterSpacing: 1, color: COLORS.muted },
  goldLabel: { fontSize: 7, letterSpacing: 1, color: COLORS.gold, fontFamily: "Helvetica-Bold" },
  rule: { borderBottomWidth: 1, borderBottomColor: COLORS.border, marginVertical: 10 },
});

function Masthead({ data }: { data: CompPacketData }) {
  const dateLabel = data.generatedAt
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
  return (
    <View>
      <View style={s.spaceBetween}>
        <View>
          <Text style={{ fontSize: 11, letterSpacing: 1.5, color: COLORS.gold, fontFamily: "Helvetica-Bold" }}>
            DEAL SCORER
          </Text>
          <Text style={[s.label, { marginTop: 2 }]}>AUTO-GENERATED COMP ANALYSIS</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.goldLabel]}>{dateLabel}</Text>
          <Text style={[s.label, { marginTop: 2 }]}>SUBJECT · {data.subject.address.toUpperCase()}</Text>
        </View>
      </View>
      <View style={[s.rule, { borderBottomColor: COLORS.gold, marginTop: 8, marginBottom: 0 }]} />
    </View>
  );
}

function Headline({ data }: { data: CompPacketData }) {
  const { statBand } = data;
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.goldLabel}>SOLD COMP SET · {data.tierLabel}</Text>
      <Text style={{ fontSize: 19, fontFamily: "Helvetica-Bold", color: COLORS.text, marginTop: 4 }}>
        {data.subject.address}
      </Text>
      <Text style={{ fontSize: 9.5, color: COLORS.muted, marginTop: 3 }}>
        {statBand.compCount} sold comp{statBand.compCount === 1 ? "" : "s"} supporting the{" "}
        {moneyCompact(data.scenarios.target.arv)} ARV estimate
      </Text>
    </View>
  );
}

function SoldCompsTable({ comps, totalCompCount }: { comps: PacketSoldComp[]; totalCompCount: number }) {
  const MAX_ROWS = 10;
  const shown = comps.slice(0, MAX_ROWS);
  const cols = [
    { key: "address", label: "ADDRESS", width: "30%", align: "left" as const },
    { key: "sqft", label: "SQFT", width: "10%", align: "right" as const },
    { key: "year", label: "YR BUILT", width: "12%", align: "right" as const },
    { key: "pool", label: "POOL", width: "9%", align: "center" as const },
    { key: "price", label: "SALE PRICE", width: "15%", align: "right" as const },
    { key: "ppsf", label: "$/SQFT", width: "12%", align: "right" as const },
    { key: "date", label: "SOLD", width: "12%", align: "right" as const },
  ];

  return (
    <View style={{ marginTop: 16 }}>
      <View style={s.spaceBetween}>
        <Text style={s.goldLabel}>SOLD COMPS · LAST 12 MONTHS</Text>
        {totalCompCount > shown.length && (
          <Text style={s.label}>
            CLOSEST {shown.length} OF {totalCompCount}
          </Text>
        )}
      </View>
      <View style={{ marginTop: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 5 }}>
        <View style={s.row}>
          {cols.map((c) => (
            <Text
              key={c.key}
              style={[s.label, { width: c.width, textAlign: c.align }]}
            >
              {c.label}
            </Text>
          ))}
        </View>
      </View>
      {shown.map((c, i) => (
        <View
          key={i}
          style={[
            s.row,
            {
              paddingVertical: 5,
              borderBottomWidth: i === shown.length - 1 ? 0 : 0.5,
              borderBottomColor: COLORS.border,
            },
          ]}
        >
          <Text style={{ width: "30%", fontSize: 8.5 }}>{c.address}</Text>
          <Text style={{ width: "10%", textAlign: "right", fontSize: 8.5 }}>
            {c.sqft ? c.sqft.toLocaleString("en-US") : "—"}
          </Text>
          <Text style={{ width: "12%", textAlign: "right", fontSize: 8.5 }}>{c.yearBuilt ?? "—"}</Text>
          <Text style={{ width: "9%", textAlign: "center", fontSize: 8.5 }}>
            {c.pool === null ? "—" : c.pool ? "Y" : "N"}
          </Text>
          <Text style={{ width: "15%", textAlign: "right", fontSize: 8.5, fontFamily: "Helvetica-Bold" }}>
            {money(c.salePrice)}
          </Text>
          <Text style={{ width: "12%", textAlign: "right", fontSize: 8.5 }}>
            {c.pricePerSqft ? money(c.pricePerSqft) : "—"}
          </Text>
          <Text style={{ width: "12%", textAlign: "right", fontSize: 8.5, color: COLORS.muted }}>
            {dateShort(c.saleDate)}
          </Text>
        </View>
      ))}
      {shown.length === 0 && (
        <Text style={{ marginTop: 6, fontSize: 8.5, color: COLORS.muted }}>No individual sold comps available.</Text>
      )}
    </View>
  );
}

function StatBand({ data }: { data: CompPacketData }) {
  const { statBand } = data;
  const belowOrAbove = statBand.listPricePerSqft <= statBand.areaPricePerSqft ? "below" : "above";
  const pctDiff = Math.abs(
    (statBand.areaPricePerSqft - statBand.listPricePerSqft) / statBand.areaPricePerSqft
  );

  const stats: { label: string; value: string; sub?: string; color: string }[] = [
    { label: "LIST PRICE", value: money(statBand.listPrice), color: COLORS.text },
    {
      label: "LIST $/SQFT VS AREA",
      value: money(statBand.listPricePerSqft),
      sub: `${pct1(pctDiff)} ${belowOrAbove} ${money(statBand.areaPricePerSqft)} avg`,
      color: COLORS.gold,
    },
    { label: "EST. ARV", value: moneyCompact(statBand.arv), color: COLORS.gold },
    {
      label: "MARGIN %",
      value: pct1(statBand.marginPct),
      color: statBand.marginPct >= 0 ? COLORS.green : COLORS.text,
    },
    { label: "COMP COUNT", value: String(statBand.compCount), color: COLORS.text },
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        marginTop: 16,
        backgroundColor: COLORS.cardBg,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 3,
        paddingVertical: 12,
      }}
    >
      {stats.map((stat, i) => (
        <View
          key={stat.label}
          style={{
            width: "20%",
            paddingHorizontal: 10,
            borderLeftWidth: i === 0 ? 0 : 0.5,
            borderLeftColor: COLORS.border,
          }}
        >
          <Text style={[s.label, { fontSize: 6.5 }]}>{stat.label}</Text>
          <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: stat.color, marginTop: 3 }}>
            {stat.value}
          </Text>
          {stat.sub && <Text style={{ fontSize: 6.5, color: COLORS.muted, marginTop: 2 }}>{stat.sub}</Text>}
        </View>
      ))}
    </View>
  );
}

function ScenarioCard({ scenario }: { scenario: PacketScenario }) {
  const rows: { label: string; value: string; bold?: boolean; color?: string; rule?: boolean }[] = [
    { label: "Purchase (list price)", value: money(scenario.purchase) },
    { label: "Rehab estimate", value: money(scenario.rehab) },
    { label: "ARV", value: money(scenario.arv), rule: true },
    {
      label: "Projected profit",
      value: money(scenario.profit),
      bold: true,
      color: scenario.profit >= 0 ? COLORS.green : COLORS.text,
    },
    { label: "Margin %", value: pct1(scenario.marginPct) },
  ];

  return (
    <View
      style={{
        width: "100%",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 3,
        padding: 12,
      }}
    >
      <View style={s.spaceBetween}>
        <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: COLORS.text }}>
          {scenario.headline}
        </Text>
        <View
          style={{
            borderWidth: 1,
            borderColor: COLORS.gold,
            borderRadius: 2,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Text style={{ fontSize: 6.5, letterSpacing: 1, color: COLORS.gold, fontFamily: "Helvetica-Bold" }}>
            {scenario.label}
          </Text>
        </View>
      </View>
      {/* Constrained to a fixed width so label/value pairs stay close together
          rather than stretching across the whole (now full-width) card. */}
      <View style={{ marginTop: 10, width: 320 }}>
        {rows.map((r) => (
          <View key={r.label}>
            {r.rule && <View style={{ borderBottomWidth: 0.5, borderBottomColor: COLORS.border, marginVertical: 5 }} />}
            <View style={[s.spaceBetween, { marginBottom: 5 }]}>
              <Text style={{ fontSize: 8.5, color: COLORS.muted }}>{r.label}</Text>
              <Text
                style={{
                  fontSize: r.bold ? 10 : 8.5,
                  fontFamily: r.bold ? "Helvetica-Bold" : "Helvetica",
                  color: r.color ?? COLORS.text,
                }}
              >
                {r.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function CalloutBox({ data }: { data: CompPacketData }) {
  return (
    <View
      style={{
        marginTop: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderLeftWidth: 3,
        borderLeftColor: COLORS.gold,
        borderRadius: 2,
        padding: 12,
      }}
    >
      <Text style={s.goldLabel}>WHAT THE COMPS TELL US</Text>
      <Text style={{ fontSize: 8.5, color: COLORS.text, marginTop: 6, lineHeight: 1.5 }}>
        {data.calloutText}
      </Text>
    </View>
  );
}

function Footer({ data }: { data: CompPacketData }) {
  const generated = data.generatedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <View style={{ position: "absolute", bottom: 20, left: 32, right: 32 }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: COLORS.border, marginBottom: 6 }} />
      <Text style={{ fontSize: 6.5, color: COLORS.muted }}>
        Source: Maricopa County Assessor Sales Affidavits &amp; Residential Master. Figures are estimates
        for underwriting discussion only, not an appraisal. Generated {generated}.
      </Text>
    </View>
  );
}

export function CompPacketDocument({ data }: { data: CompPacketData }) {
  return (
    <Document title={`Comp Packet — ${data.subject.address}`}>
      <Page size="LETTER" style={s.page}>
        <Masthead data={data} />
        <Headline data={data} />
        <SoldCompsTable comps={data.soldComps} totalCompCount={data.statBand.compCount} />
        <StatBand data={data} />
        <View style={{ marginTop: 16 }}>
          <ScenarioCard scenario={data.scenarios.target} />
        </View>
        <CalloutBox data={data} />
        <Footer data={data} />
      </Page>
    </Document>
  );
}
