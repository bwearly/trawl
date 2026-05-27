import { db } from "../lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicians,
  researchSignals,
} from "../lib/db/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getPoliticianLeaderboard } from "../lib/domain/politicians/get-politicians-leaderboard";
import { computeConfidencePenalty, DEFAULT_RELEVANCE_SCORES, scoreSignal } from "../lib/domain/scoring/scoreSignals";

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

function weightedComponentToRaw(weightedValue: number | string | null | undefined, weight: number, fallbackRaw: number) {
  if (weightedValue == null) return fallbackRaw;
  const numeric = Number(weightedValue);
  if (!Number.isFinite(numeric)) return fallbackRaw;
  return (numeric / weight) * 100;
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
      return7d: disclosurePerformanceWindows.return7d,
      spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
      return90d: disclosurePerformanceWindows.return90d,
      spyReturn90d: disclosurePerformanceWindows.spyReturn90d,
      historicalSampleSize: sql<number>`(
        select count(*)::int
        from disclosures d2
        where d2.politician_id = ${disclosures.politicianId}
          and d2.id < ${disclosures.id}
      )`,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .leftJoin(disclosurePerformanceWindows, eq(disclosurePerformanceWindows.disclosureId, disclosures.id))
    .orderBy(desc(researchSignals.score), desc(researchSignals.id))
    .limit(20);

  console.log("\n=== Top 20 signals by score ===");
  const staleSignals: Array<{
    signalId: number;
    ticker: string | null;
    politicianName: string;
    storedScore: number;
    recomputedScore: number;
    delta: number;
    storedReason: string | null;
    recomputedReason: string;
    missingPerformance: boolean;
  }> = [];

  for (const row of rows) {
    const amount = row.amountRangeLabel ?? `${row.amountMin ?? "?"}-${row.amountMax ?? "?"}`;
    const missingPerformance = row.return30d == null || row.spyReturn30d == null ? "yes" : "no";
    const daysSinceFiling = row.filingDate
      ? Math.floor((Date.now() - row.filingDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const recomputed = scoreSignal({
      tradeType: row.tradeType,
      amountMin: row.amountMin,
      amountMax: row.amountMax,
      filingLagDays: row.filingLagDays,
      daysSinceFiling,
      return7d: row.return7d,
      spyReturn7d: row.spyReturn7d,
      return30d: row.return30d,
      spyReturn30d: row.spyReturn30d,
      return90d: row.return90d,
      spyReturn90d: row.spyReturn90d,
      committeeRelevanceScore: DEFAULT_RELEVANCE_SCORES.committee,
      clusterScore: DEFAULT_RELEVANCE_SCORES.cluster,
      userRelevanceScore: DEFAULT_RELEVANCE_SCORES.user,
    });
    const recomputedFromStoredComponents = scoreSignal({
      tradeType: row.tradeType,
      amountMin: row.amountMin,
      amountMax: row.amountMax,
      filingLagDays: row.filingLagDays,
      daysSinceFiling,
      return7d: row.return7d,
      spyReturn7d: row.spyReturn7d,
      return30d: row.return30d,
      spyReturn30d: row.spyReturn30d,
      return90d: row.return90d,
      spyReturn90d: row.spyReturn90d,
      committeeRelevanceScore: weightedComponentToRaw(row.committeeRelevanceScore, 8, DEFAULT_RELEVANCE_SCORES.committee),
      clusterScore: weightedComponentToRaw(row.clusterScore, 5, DEFAULT_RELEVANCE_SCORES.cluster),
      userRelevanceScore: weightedComponentToRaw(row.userRelevanceScore, 5, DEFAULT_RELEVANCE_SCORES.user),
    });
    const confidencePenalty = computeConfidencePenalty({
      historicalSampleSize: Number(row.historicalSampleSize ?? 0),
      return7d: row.return7d,
      spyReturn7d: row.spyReturn7d,
      return30d: row.return30d,
      spyReturn30d: row.spyReturn30d,
    });
    const recomputedAdjustedScore = Math.max(0, recomputed.totalScore - confidencePenalty);
    const storedScore = Number(row.score);
    const delta = Number.isFinite(storedScore) ? Math.round((storedScore - recomputedAdjustedScore) * 100) / 100 : 0;
    const scoreStale = Math.abs(delta) > 0.5;
    const reasonStale = (row.primaryReason ?? "") !== recomputed.primaryReason;
    const stale = scoreStale || reasonStale;
    if (stale) {
      staleSignals.push({
        signalId: row.signalId,
        ticker: row.ticker,
        politicianName: row.politicianName,
        storedScore,
        recomputedScore: recomputedAdjustedScore,
        delta,
        storedReason: row.primaryReason,
        recomputedReason: recomputed.primaryReason,
        missingPerformance: missingPerformance === "yes",
      });
    }

    console.log(
      `#${row.signalId} ${row.ticker} | ${row.politicianName} | ${row.tradeType} | amount=${amount} | lag=${row.filingLagDays ?? "NULL"}d | score=${fmt(row.score)}`
    );
    console.log(
      `   breakdown: tradeType=${fmt(row.tradeTypeScore)}, tradeSize=${fmt(row.tradeSizeScore)}, freshness=${fmt(row.filingFreshnessScore)}, historical=${fmt(row.historicalPoliticianScore)}, momentum=${fmt(row.momentumScore)}, committee=${fmt(row.committeeRelevanceScore)}, cluster=${fmt(row.clusterScore)}, user=${fmt(row.userRelevanceScore)} | missingPerf=${missingPerformance}`
    );
    console.log(`   reason: ${row.primaryReason ?? "—"} | ${row.reasonSummary ?? "—"}`);
    console.log(
      `   recomputed: raw=${fmt(recomputed.totalScore)}, adjusted=${fmt(recomputedAdjustedScore)} (penalty=${confidencePenalty}, delta=${fmt(delta)}), reason=${recomputed.primaryReason} | stale=${stale ? "yes" : "no"}`
    );
    console.log(
      `   recomputed breakdown: tradeType=${fmt(recomputed.breakdown.tradeTypeScore)}, tradeSize=${fmt(recomputed.breakdown.tradeSizeScore)}, freshness=${fmt(recomputed.breakdown.filingFreshnessScore)}, historical=${fmt(recomputed.breakdown.historicalPoliticianScore)}, momentum=${fmt(recomputed.breakdown.momentumScore)}, committee=${fmt(recomputed.breakdown.committeeRelevanceScore)}, cluster=${fmt(recomputed.breakdown.clusterScore)}, user=${fmt(recomputed.breakdown.userRelevanceScore)}`
    );
    const defaultDriftDelta = Math.round((recomputedFromStoredComponents.totalScore - recomputed.totalScore) * 100) / 100;
    if (Math.abs(defaultDriftDelta) > 0.1) {
      console.log(
        `   warning: recompute input drift detected (stored-component relevance vs default relevance delta=${fmt(defaultDriftDelta)})`
      );
    }
    if (Math.abs(delta) > 0.1) {
      console.log(
        `   guard: recalc-vs-diagnostics drift detected (|delta|=${fmt(Math.abs(delta))} > 0.10)`
      );
    }
  }

  console.log("\n=== Stored vs recomputed staleness summary (top 20 by stored score) ===");
  if (staleSignals.length === 0) {
    console.log("None");
  } else {
    for (const row of staleSignals) {
      console.log(
        `#${row.signalId} ${row.ticker} | ${row.politicianName} | stored=${fmt(row.storedScore)} | recomputed=${fmt(row.recomputedScore)} | delta=${fmt(row.delta)} | missingPerf=${row.missingPerformance ? "yes" : "no"}`
      );
      console.log(
        `   reason stored="${row.storedReason ?? "—"}" | recomputed="${row.recomputedReason}"`
      );
    }
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
  const strongReasonBelowThreshold = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      politicianName: politicians.fullName,
      primaryReason: researchSignals.primaryReason,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .where(
      and(
        sql`${researchSignals.score}::numeric < 70`,
        sql`${researchSignals.primaryReason} ilike '%Strong trade context and timing%'`
      )
    )
    .orderBy(desc(researchSignals.score))
    .limit(20);

  console.log("\n=== Warning: stored reason says 'Strong trade context and timing' with score < 70 ===");
  if (strongReasonBelowThreshold.length === 0) console.log("None");
  for (const row of strongReasonBelowThreshold) {
    console.log(`${row.signalId} ${row.ticker} | ${row.politicianName} | score=${fmt(row.score)} | reason=${row.primaryReason ?? "—"}`);
  }

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

  const missingPerformanceWithoutConservativeReason = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      politicianName: politicians.fullName,
      primaryReason: researchSignals.primaryReason,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .leftJoin(disclosurePerformanceWindows, eq(disclosurePerformanceWindows.disclosureId, disclosures.id))
    .where(
      and(
        or(isNull(disclosurePerformanceWindows.return30d), isNull(disclosurePerformanceWindows.spyReturn30d)),
        sql`${researchSignals.primaryReason} not ilike '%Limited confidence due to missing performance history%'`
      )
    )
    .orderBy(desc(researchSignals.score))
    .limit(20);

  console.log("\n=== Warning: missingPerf=yes but stored reason lacks conservative wording ===");
  if (missingPerformanceWithoutConservativeReason.length === 0) console.log("None");
  for (const row of missingPerformanceWithoutConservativeReason) {
    console.log(`${row.signalId} ${row.ticker} | ${row.politicianName} | score=${fmt(row.score)} | reason=${row.primaryReason ?? "—"}`);
  }

  console.log("\nHint: if many rows are stale, run `npm run signals:recalculate` then re-run this diagnostic.");
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
