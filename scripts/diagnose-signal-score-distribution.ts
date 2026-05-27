import { isNotNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { disclosures, disclosurePerformanceWindows, researchSignals } from "../lib/db/schema";

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return "n=0";
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  return `n=${sorted.length} min=${fmt(sorted[0])} p25=${fmt(percentile(sorted, 0.25))} median=${fmt(percentile(sorted, 0.5))} p75=${fmt(percentile(sorted, 0.75))} p90=${fmt(percentile(sorted, 0.9))} p95=${fmt(percentile(sorted, 0.95))} max=${fmt(sorted[sorted.length - 1])}`;
}

async function main() {
  const rows = await db
    .select({
      score: researchSignals.score,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      ticker: researchSignals.ticker,
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      tradeType: disclosures.tradeType,
    })
    .from(researchSignals)
    .innerJoin(disclosures, sql`${researchSignals.disclosureId} = ${disclosures.id}`)
    .leftJoin(disclosurePerformanceWindows, sql`${disclosurePerformanceWindows.disclosureId} = ${disclosures.id}`)
    .where(isNotNull(researchSignals.score));

  const now = Date.now();
  const num = (v: string) => Number(v);
  const all = rows.map((r) => num(r.score));
  const recentFiled = rows.filter((r) => r.filingDate && now - r.filingDate.getTime() <= 30 * 86400000).map((r) => num(r.score));
  const tickerBacked = rows.filter((r) => !!r.ticker).map((r) => num(r.score));
  const freshActionable = rows
    .filter((r) => (r.filingLagDays ?? 9999) <= 45 && !!r.ticker && (r.tradeType === "purchase" || r.tradeType === "exchange") && (r.return7d != null || r.return30d != null))
    .map((r) => num(r.score));

  console.log("Raw score distributions");
  console.log("- all:", summarize(all));
  console.log("- recent filed (<=30d):", summarize(recentFiled));
  console.log("- ticker-backed:", summarize(tickerBacked));
  console.log("- fresh/recent actionable:", summarize(freshActionable));
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
