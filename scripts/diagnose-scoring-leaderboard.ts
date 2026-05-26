import { db } from "../lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicians,
  researchSignals,
} from "../lib/db/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getPoliticianLeaderboard } from "../lib/domain/politicians/get-politicians-leaderboard";

function fmt(v: number | string | null | undefined, digits = 2) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(digits);
}

function fmtDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

async function printTopSignals() {
  const rows = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      reasonSummary: researchSignals.reasonSummary,
      primaryReason: researchSignals.primaryReason,
      tradeType: disclosures.tradeType,
      amountMin: disclosures.amountMin,
      amountMax: disclosures.amountMax,
      amountRangeLabel: disclosures.amountRangeLabel,
      filingLagDays: disclosures.filingLagDays,
      filingDate: disclosures.filingDate,
      tradeDate: disclosures.tradeDate,
      politicianName: politicians.fullName,
      tradeTypeScore: researchSignals.tradeTypeScore,
      tradeSizeScore: researchSignals.tradeSizeScore,
      filingFreshnessScore: researchSignals.filingFreshnessScore,
      historicalPoliticianScore: researchSignals.historicalPoliticianScore,
      momentumScore: researchSignals.momentumScore,
      committeeRelevanceScore: researchSignals.committeeRelevanceScore,
      clusterScore: researchSignals.clusterScore,
      userRelevanceScore: researchSignals.userRelevanceScore,
      return30d: disclosurePerformanceWindows.return30d,
      spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .leftJoin(disclosurePerformanceWindows, eq(disclosurePerformanceWindows.disclosureId, disclosures.id))
    .orderBy(desc(researchSignals.score), desc(researchSignals.id))
    .limit(20);

  console.log("\n=== Top 20 signals by score ===");
  for (const row of rows) {
    const amount = row.amountRangeLabel ?? `${row.amountMin ?? "?"}-${row.amountMax ?? "?"}`;
    const missingPerformance = row.return30d == null || row.spyReturn30d == null ? "yes" : "no";
    console.log(
      `#${row.signalId} ${row.ticker} | ${row.politicianName} | ${row.tradeType} | amount=${amount} | lag=${row.filingLagDays ?? "NULL"}d | score=${fmt(row.score)}`
    );
    console.log(
      `   breakdown: tradeType=${fmt(row.tradeTypeScore)}, tradeSize=${fmt(row.tradeSizeScore)}, freshness=${fmt(row.filingFreshnessScore)}, historical=${fmt(row.historicalPoliticianScore)}, momentum=${fmt(row.momentumScore)}, committee=${fmt(row.committeeRelevanceScore)}, cluster=${fmt(row.clusterScore)}, user=${fmt(row.userRelevanceScore)} | missingPerf=${missingPerformance}`
    );
    console.log(`   reason: ${row.primaryReason ?? "—"} | ${row.reasonSummary ?? "—"}`);
  }
}

async function printTopLeaderboard() {
  const rows = await getPoliticianLeaderboard("all");
  const top = rows.slice(0, 20);
  console.log("\n=== Top 20 politicians by leaderboard score ===");
  for (const row of top) {
    console.log(
      `${row.fullName} (${row.chamber}/${row.party ?? "—"}/${row.state ?? "—"}) | leaderboard=${fmt(row.leaderboardScore)} | disclosures=${row.totalDisclosures} | validPerf=${row.validPerformanceCount} | win30=${fmt(row.winRate30d)} | alpha30=${fmt(row.avgAlpha30d)} | lag=${fmt(row.avgFilingLagDays)}d | lastTrade=${fmtDate(row.lastTradeDate)}`
    );
  }

  const lowSampleHighScore = rows
    .filter((r) => r.leaderboardScore >= 65 && r.validPerformanceCount < 3)
    .slice(0, 20);
  console.log("\n=== Warning: high leaderboard score but low validPerformanceCount (<3) ===");
  if (lowSampleHighScore.length === 0) console.log("None");
  for (const row of lowSampleHighScore) {
    console.log(`${row.fullName} | leaderboard=${fmt(row.leaderboardScore)} | validPerf=${row.validPerformanceCount} | disclosures=${row.totalDisclosures}`);
  }

  const recencySorted = [...rows].sort(
    (a, b) => (b.lastTradeDate?.getTime() ?? 0) - (a.lastTradeDate?.getTime() ?? 0)
  );
  console.log("\n=== Compare top 10 new ranking vs recency-first ranking ===");
  for (let i = 0; i < Math.min(10, rows.length); i += 1) {
    const ranked = rows[i];
    const recent = recencySorted[i];
    console.log(
      `rank#${i + 1}: scoreRank=${ranked.fullName} (${fmt(ranked.leaderboardScore)}) || recencyRank=${recent.fullName} (${fmtDate(recent.lastTradeDate)})`
    );
  }
}

async function printSignalWarnings() {
  const staleHighScore = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      filingLagDays: disclosures.filingLagDays,
      politicianName: politicians.fullName,
      reasonSummary: researchSignals.reasonSummary,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .where(and(sql`${researchSignals.score} >= 70`, sql`${disclosures.filingLagDays} > 90`))
    .orderBy(desc(researchSignals.score))
    .limit(20);

  console.log("\n=== Warning: high score (>=70) but stale filing lag (>90d) ===");
  if (staleHighScore.length === 0) console.log("None");
  for (const row of staleHighScore) {
    console.log(`${row.signalId} ${row.ticker} | ${row.politicianName} | score=${fmt(row.score)} | lag=${row.filingLagDays} | ${row.reasonSummary ?? "—"}`);
  }

  const missingPerformance = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      filingLagDays: disclosures.filingLagDays,
      politicianName: politicians.fullName,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .leftJoin(disclosurePerformanceWindows, eq(disclosurePerformanceWindows.disclosureId, disclosures.id))
    .where(or(isNull(disclosurePerformanceWindows.return30d), isNull(disclosurePerformanceWindows.spyReturn30d)))
    .orderBy(desc(researchSignals.score))
    .limit(20);

  console.log("\n=== Signals with missing 30d performance windows (top by score) ===");
  for (const row of missingPerformance) {
    console.log(`${row.signalId} ${row.ticker} | ${row.politicianName} | score=${fmt(row.score)} | lag=${row.filingLagDays ?? "NULL"}`);
  }
}

async function main() {
  console.log("Diagnostics: scoring and leaderboard (read-only)");
  await printTopSignals();
  await printTopLeaderboard();
  await printSignalWarnings();
}

main().catch((error) => {
  console.error("Diagnostics failed:", error);
  process.exit(1);
});
