import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import {
  shouldGenerateAlert,
  ALERT_ELIGIBILITY_THRESHOLDS,
} from "../lib/domain/alerts/should-generate-alert";
import { getFilingFreshnessLabel, type FilingFreshnessLabel } from "../lib/domain/signals/filing-freshness";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicians,
  priceHistory,
  researchSignals,
} from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";

type EvaluatedSignalRow = {
  signalId: number;
  disclosureId: number;
  politicianId: number;
  signalStatus: string;
  ticker: string;
  score: number;
  tradeType: string;
  politicianName: string;
  party: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
  filingLagDays: number | null;
  return7d: number | null;
  return30d: number | null;
  spyReturn7d: number | null;
  spyReturn30d: number | null;
  tradeTypeScore: number | null;
  tradeSizeScore: number | null;
  filingFreshnessScore: number | null;
  historicalPoliticianScore: number | null;
  momentumScore: number | null;
  committeeRelevanceScore: number | null;
  clusterScore: number | null;
  userRelevanceScore: number | null;
};

type BucketKey = "0-39" | "40-59" | "60-79" | "80-100";

type BucketStats = {
  bucket: BucketKey;
  count: number;

  avgReturn7d: number | null;
  avgReturn30d: number | null;
  avgAlpha7d: number | null;
  avgAlpha30d: number | null;

  winRate7d: number | null;
  winRate30d: number | null;
};

type SummaryStats = {
  count: number;
  avgReturn7d: number | null;
  avgReturn30d: number | null;
  avgAlpha7d: number | null;
  avgAlpha30d: number | null;
  winRate7d: number | null;
  winRate30d: number | null;
  sample: {
    return7d: number;
    return30d: number;
    alpha7d: number;
    alpha30d: number;
  };
};

type TradeTypeStats = {
  tradeType: string;
  stats: SummaryStats;
};

type AlertBlockedByStats = {
  blockedBy: string;
  count: number;
};

type FactorBandLabel = "Low" | "Medium" | "High" | "Missing";

type FactorBandStats = {
  factor: FactorName;
  band: FactorBandLabel;
  stats: SummaryStats;
};

type FactorName =
  | "momentumScore"
  | "historicalPoliticianScore"
  | "tradeSizeScore"
  | "filingFreshnessScore";

type FactorBandThresholds = {
  lowUpperExclusive: number;
  mediumUpperInclusive: number;
  rangeLabel: string;
};

const FACTORS_TO_ANALYZE: Array<{ key: FactorName; label: string }> = [
  { key: "momentumScore", label: "Momentum" },
  { key: "historicalPoliticianScore", label: "Historical Politician" },
  { key: "tradeSizeScore", label: "Trade Size" },
  { key: "filingFreshnessScore", label: "Filing Freshness" },
];

const FACTOR_BAND_THRESHOLDS: Record<FactorName, FactorBandThresholds> = {
  momentumScore: {
    lowUpperExclusive: 5,
    mediumUpperInclusive: 10,
    rangeLabel: "0-22",
  },
  historicalPoliticianScore: {
    lowUpperExclusive: 6,
    mediumUpperInclusive: 12,
    rangeLabel: "0-20",
  },
  tradeSizeScore: {
    lowUpperExclusive: 6,
    mediumUpperInclusive: 12,
    rangeLabel: "0-18",
  },
  filingFreshnessScore: {
    lowUpperExclusive: 4,
    mediumUpperInclusive: 8,
    rangeLabel: "0-12",
  },
};

function parseNumeric(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function winRate(values: number[]): number | null {
  if (values.length === 0) return null;
  const wins = values.filter((value) => value > 0).length;
  return round2((wins / values.length) * 100);
}

function getBucket(score: number): BucketKey {
  if (score < 40) return "0-39";
  if (score < 60) return "40-59";
  if (score < 80) return "60-79";
  return "80-100";
}

function getFactorBand(
  factor: FactorName,
  score: number | null
): FactorBandLabel {
  if (score == null) return "Missing";
  const thresholds = FACTOR_BAND_THRESHOLDS[factor];
  if (score < thresholds.lowUpperExclusive) return "Low";
  if (score <= thresholds.mediumUpperInclusive) return "Medium";
  return "High";
}

function calcAlpha(
  stockReturn: number | null,
  benchmarkReturn: number | null
): number | null {
  if (stockReturn == null || benchmarkReturn == null) return null;
  return round2(stockReturn - benchmarkReturn);
}

function valueOrDash(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

function evaluateSummary(rows: EvaluatedSignalRow[]): SummaryStats {
  const returns7d = rows
    .map((row) => row.return7d)
    .filter((value): value is number => value != null);

  const returns30d = rows
    .map((row) => row.return30d)
    .filter((value): value is number => value != null);

  const alpha7d = rows
    .map((row) => calcAlpha(row.return7d, row.spyReturn7d))
    .filter((value): value is number => value != null);

  const alpha30d = rows
    .map((row) => calcAlpha(row.return30d, row.spyReturn30d))
    .filter((value): value is number => value != null);

  return {
    count: rows.length,
    avgReturn7d: average(returns7d),
    avgReturn30d: average(returns30d),
    avgAlpha7d: average(alpha7d),
    avgAlpha30d: average(alpha30d),
    winRate7d: winRate(alpha7d),
    winRate30d: winRate(alpha30d),
    sample: {
      return7d: returns7d.length,
      return30d: returns30d.length,
      alpha7d: alpha7d.length,
      alpha30d: alpha30d.length,
    },
  };
}

async function loadSignals(): Promise<EvaluatedSignalRow[]> {
  const rows = await db
    .select({
      signalId: researchSignals.id,
      disclosureId: disclosures.id,
      politicianId: researchSignals.politicianId,
      signalStatus: researchSignals.signalStatus,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      tradeType: disclosures.tradeType,
      politicianName: politicians.fullName,
      party: politicians.party,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
      spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
      tradeTypeScore: researchSignals.tradeTypeScore,
      tradeSizeScore: researchSignals.tradeSizeScore,
      filingFreshnessScore: researchSignals.filingFreshnessScore,
      historicalPoliticianScore: researchSignals.historicalPoliticianScore,
      momentumScore: researchSignals.momentumScore,
      committeeRelevanceScore: researchSignals.committeeRelevanceScore,
      clusterScore: researchSignals.clusterScore,
      userRelevanceScore: researchSignals.userRelevanceScore,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    );

  return rows.map((row) => ({
    signalId: row.signalId,
    disclosureId: row.disclosureId,
    politicianId: row.politicianId,
    signalStatus: row.signalStatus,
    ticker: row.ticker,
    score: Number(row.score),
    tradeType: row.tradeType,
    politicianName: row.politicianName,
    party: row.party,
    tradeDate: row.tradeDate,
    filingDate: row.filingDate,
    filingLagDays: row.filingLagDays,
    return7d: parseNumeric(row.return7d),
    return30d: parseNumeric(row.return30d),
    spyReturn7d: parseNumeric(row.spyReturn7d),
    spyReturn30d: parseNumeric(row.spyReturn30d),
    tradeTypeScore: parseNumeric(row.tradeTypeScore),
    tradeSizeScore: parseNumeric(row.tradeSizeScore),
    filingFreshnessScore: parseNumeric(row.filingFreshnessScore),
    historicalPoliticianScore: parseNumeric(row.historicalPoliticianScore),
    momentumScore: parseNumeric(row.momentumScore),
    committeeRelevanceScore: parseNumeric(row.committeeRelevanceScore),
    clusterScore: parseNumeric(row.clusterScore),
    userRelevanceScore: parseNumeric(row.userRelevanceScore),
  }));
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function computeConfidencePenalty(
  row: EvaluatedSignalRow,
  historicalSampleSize: number
): number {
  let confidencePenalty = 0;

  if (historicalSampleSize === 0) confidencePenalty += 4;
  else if (historicalSampleSize === 1) confidencePenalty += 3;
  else if (historicalSampleSize === 2) confidencePenalty += 2;
  else if (historicalSampleSize <= 4) confidencePenalty += 1;

  if (row.return30d == null || row.spyReturn30d == null) confidencePenalty += 3;
  if (row.return7d == null || row.spyReturn7d == null) confidencePenalty += 2;

  return confidencePenalty;
}

function evaluateAlertBlockedBy(rows: EvaluatedSignalRow[]): AlertBlockedByStats[] {
  const counts = new Map<string, number>();
  const byPolitician = new Map<number, EvaluatedSignalRow[]>();

  for (const row of rows) {
    const existing = byPolitician.get(row.politicianId) ?? [];
    existing.push(row);
    byPolitician.set(row.politicianId, existing);
  }

  for (const [, politicianRows] of byPolitician) {
    politicianRows.sort((a, b) => a.disclosureId - b.disclosureId);
    const priorAlphas: number[] = [];

    for (const row of politicianRows) {
      const confidencePenalty = computeConfidencePenalty(row, priorAlphas.length);

      const eligibility = shouldGenerateAlert({
        signalStatus: row.signalStatus,
        tradeType: row.tradeType,
        adjustedScore: row.score,
        confidencePenalty,
        filingLagDays: row.filingLagDays,
      });

      const blockedBy = eligibility.blockedBy ?? "eligible";
      counts.set(blockedBy, (counts.get(blockedBy) ?? 0) + 1);

      const alpha30d = calcAlpha(row.return30d, row.spyReturn30d);
      const alpha7d = calcAlpha(row.return7d, row.spyReturn7d);
      const chosenAlpha = alpha30d ?? alpha7d;

      if (chosenAlpha != null) {
        priorAlphas.push(chosenAlpha);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([blockedBy, count]) => ({ blockedBy, count }))
    .sort((a, b) => b.count - a.count);
}

async function printDiagnostics(rows: EvaluatedSignalRow[]) {
  const today = startOfUtcDay(new Date());
  const latestPriceRows = await db
    .select({
      ticker: priceHistory.ticker,
      latestDate: sql<Date>`max(${priceHistory.date})`,
    })
    .from(priceHistory)
    .groupBy(priceHistory.ticker);

  const latestPriceDateByTicker = new Map<string, Date>();
  for (const row of latestPriceRows) {
    latestPriceDateByTicker.set(row.ticker.trim().toUpperCase(), row.latestDate);
  }

  const spyLatestDate = latestPriceDateByTicker.get("SPY");
  const missingPriceByTicker = new Map<string, number>();
  const invalidOrFutureTradeDate = {
    missingAnchorDate: 0,
    tradeDateAfterFilingDate: 0,
    futureTradeDate: 0,
    total: 0,
  };
  const tooRecentCounts = {
    window7d: 0,
    window30d: 0,
  };

  const filingLags = rows
    .map((row) => row.filingLagDays)
    .filter((lag): lag is number => lag != null);

  for (const row of rows) {
    const normalizedTicker = row.ticker.trim().toUpperCase();
    const tradeAnchor = row.tradeDate ?? row.filingDate;

    if (!latestPriceDateByTicker.has(normalizedTicker)) {
      missingPriceByTicker.set(
        normalizedTicker,
        (missingPriceByTicker.get(normalizedTicker) ?? 0) + 1
      );
    }

    let hasInvalid = false;
    if (!tradeAnchor) {
      invalidOrFutureTradeDate.missingAnchorDate += 1;
      hasInvalid = true;
    }

    if (row.tradeDate && row.filingDate && row.tradeDate > row.filingDate) {
      invalidOrFutureTradeDate.tradeDateAfterFilingDate += 1;
      hasInvalid = true;
    }

    if (row.tradeDate && startOfUtcDay(row.tradeDate) > today) {
      invalidOrFutureTradeDate.futureTradeDate += 1;
      hasInvalid = true;
    }

    if (hasInvalid) {
      invalidOrFutureTradeDate.total += 1;
    }

    if (!tradeAnchor) continue;

    const anchor = startOfUtcDay(tradeAnchor);
    const tickerLatestDate = latestPriceDateByTicker.get(normalizedTicker);
    const required7d = addDays(anchor, 7);
    const required30d = addDays(anchor, 30);

    if (
      !tickerLatestDate ||
      tickerLatestDate < required7d ||
      (spyLatestDate != null && spyLatestDate < required7d)
    ) {
      tooRecentCounts.window7d += 1;
    }

    if (
      !tickerLatestDate ||
      tickerLatestDate < required30d ||
      (spyLatestDate != null && spyLatestDate < required30d)
    ) {
      tooRecentCounts.window30d += 1;
    }
  }

  const momentumValues = rows
    .map((row) => row.momentumScore)
    .filter((score): score is number => score != null);

  const minLag = filingLags.length > 0 ? Math.min(...filingLags) : null;
  const maxLag = filingLags.length > 0 ? Math.max(...filingLags) : null;
  const avgLag = average(filingLags);
  const minMomentum =
    momentumValues.length > 0 ? Math.min(...momentumValues) : null;
  const maxMomentum =
    momentumValues.length > 0 ? Math.max(...momentumValues) : null;

  const alertBlockedByStats = evaluateAlertBlockedBy(rows);
  const freshnessCounts = new Map<FilingFreshnessLabel, number>();
  let excludedForExtremeLag = 0;

  for (const row of rows) {
    const freshness = getFilingFreshnessLabel(row.filingLagDays);
    freshnessCounts.set(freshness, (freshnessCounts.get(freshness) ?? 0) + 1);
    if (
      row.filingLagDays != null &&
      row.filingLagDays > ALERT_ELIGIBILITY_THRESHOLDS.maxFilingLagDays
    ) {
      excludedForExtremeLag += 1;
    }
  }

  console.log("=== DIAGNOSTICS ===\n");
  console.log("Disclosures missing price history rows (by ticker):");
  if (missingPriceByTicker.size === 0) {
    console.log("  None");
  } else {
    Array.from(missingPriceByTicker.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([ticker, count]) => console.log(`  ${ticker}: ${count}`));
  }

  console.log("\nDisclosures too recent for windows:");
  console.log(`  7d window unavailable: ${tooRecentCounts.window7d}`);
  console.log(`  30d window unavailable: ${tooRecentCounts.window30d}`);

  console.log("\nInvalid/future trade date diagnostics:");
  console.log(`  Missing trade+filing anchor date: ${invalidOrFutureTradeDate.missingAnchorDate}`);
  console.log(`  Trade date after filing date: ${invalidOrFutureTradeDate.tradeDateAfterFilingDate}`);
  console.log(`  Future trade dates: ${invalidOrFutureTradeDate.futureTradeDate}`);
  console.log(`  Total affected disclosures: ${invalidOrFutureTradeDate.total}`);

  console.log("\nFiling lag (days):");
  console.log(`  min=${minLag ?? "—"} max=${maxLag ?? "—"} avg=${avgLag ?? "—"}`);
  console.log(
    `  excluded from alert eligibility due to lag > ${ALERT_ELIGIBILITY_THRESHOLDS.maxFilingLagDays} days: ${excludedForExtremeLag}`
  );

  console.log("\nSignal count by freshness label:");
  for (const label of ["Fresh", "Normal", "Delayed", "Stale", "Historical", "Unknown"] as const) {
    console.log(`  ${label}: ${freshnessCounts.get(label) ?? 0}`);
  }

  console.log("\nMomentum score range:");
  console.log(`  min=${minMomentum ?? "—"} max=${maxMomentum ?? "—"}`);

  console.log("\nSignal count by alertBlockedBy:");
  for (const row of alertBlockedByStats) {
    console.log(`  ${row.blockedBy}: ${row.count}`);
  }

  if (minLag != null && minLag < 0) {
    console.log(
      `\nWARNING: Found negative filing lag values (min=${minLag}). Investigate trade/filing date parsing.`
    );
  }

  console.log("");
}

function evaluateBuckets(rows: EvaluatedSignalRow[]): BucketStats[] {
  const bucketOrder: BucketKey[] = ["0-39", "40-59", "60-79", "80-100"];

  return bucketOrder.map((bucket) => {
    const bucketRows = rows.filter((row) => getBucket(row.score) === bucket);
    const summary = evaluateSummary(bucketRows);
    const returns7d = bucketRows
      .map((row) => row.return7d)
      .filter((value): value is number => value != null);
    const returns30d = bucketRows
      .map((row) => row.return30d)
      .filter((value): value is number => value != null);

    return {
      bucket,
      count: bucketRows.length,
      avgReturn7d: summary.avgReturn7d,
      avgReturn30d: summary.avgReturn30d,
      avgAlpha7d: summary.avgAlpha7d,
      avgAlpha30d: summary.avgAlpha30d,
      winRate7d: winRate(returns7d),
      winRate30d: winRate(returns30d),
    };
  });
}

function evaluateTradeTypes(rows: EvaluatedSignalRow[]): TradeTypeStats[] {
  const tradeTypes = Array.from(
    new Set(rows.map((row) => row.tradeType.toLowerCase().trim()))
  ).sort((a, b) => {
    const preferredOrder = ["purchase", "sale", "exchange"];
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return tradeTypes.map((tradeType) => ({
    tradeType,
    stats: evaluateSummary(
      rows.filter((row) => row.tradeType.toLowerCase().trim() === tradeType)
    ),
  }));
}

function evaluateFactorBands(rows: EvaluatedSignalRow[]): FactorBandStats[] {
  const bandOrder: FactorBandLabel[] = ["Low", "Medium", "High", "Missing"];

  return FACTORS_TO_ANALYZE.flatMap(({ key }) =>
    bandOrder.map((band) => {
      const bandRows = rows.filter((row) => getFactorBand(key, row[key]) === band);

      return {
        factor: key,
        band,
        stats: evaluateSummary(bandRows),
      };
    })
  );
}

function printBucketReport(stats: BucketStats[]) {
  console.log("\n=== SCORE BUCKET REPORT ===\n");

  for (const stat of stats) {
    console.log(`Bucket ${stat.bucket}`);
    console.log(`  Count: ${stat.count}`);
    console.log(`  Avg 7d Return: ${valueOrDash(stat.avgReturn7d)}`);
    console.log(`  Avg 30d Return: ${valueOrDash(stat.avgReturn30d)}`);
    console.log(`  Avg 7d Alpha: ${valueOrDash(stat.avgAlpha7d)}`);
    console.log(`  Avg 30d Alpha: ${valueOrDash(stat.avgAlpha30d)}`);
    console.log(`  7d Win Rate: ${valueOrDash(stat.winRate7d)}`);
    console.log(`  30d Win Rate: ${valueOrDash(stat.winRate30d)}`);
    console.log("");
  }
}

function printTradeTypeReport(tradeTypeStats: TradeTypeStats[]) {
  console.log("=== TRADE TYPE REPORT ===\n");

  for (const { tradeType, stats } of tradeTypeStats) {
    console.log(`Trade Type: ${tradeType}`);
    console.log(`  Count: ${stats.count}`);
    console.log(
      `  Avg 7d Return: ${valueOrDash(stats.avgReturn7d)} (n=${stats.sample.return7d})`
    );
    console.log(
      `  Avg 30d Return: ${valueOrDash(stats.avgReturn30d)} (n=${stats.sample.return30d})`
    );
    console.log(
      `  Avg 7d Alpha: ${valueOrDash(stats.avgAlpha7d)} (n=${stats.sample.alpha7d})`
    );
    console.log(
      `  Avg 30d Alpha: ${valueOrDash(stats.avgAlpha30d)} (n=${stats.sample.alpha30d})`
    );
    console.log(
      `  7d Win Rate (alpha > 0): ${valueOrDash(stats.winRate7d)} (n=${stats.sample.alpha7d})`
    );
    console.log(
      `  30d Win Rate (alpha > 0): ${valueOrDash(stats.winRate30d)} (n=${stats.sample.alpha30d})`
    );
    console.log("");
  }
}

function printFactorBandReport(factorBandStats: FactorBandStats[]) {
  console.log("=== FACTOR BAND REPORT (alpha-relative) ===\n");
  console.log("Bands are factor-specific; Missing = null\n");

  for (const factor of FACTORS_TO_ANALYZE) {
    const thresholds = FACTOR_BAND_THRESHOLDS[factor.key];
    console.log(
      `Factor: ${factor.label} (${factor.key}, range ${thresholds.rangeLabel})`
    );
    console.log(
      `  Band rules: Low < ${thresholds.lowUpperExclusive}, Medium ${thresholds.lowUpperExclusive}-${thresholds.mediumUpperInclusive}, High > ${thresholds.mediumUpperInclusive}`
    );

    for (const bandStat of factorBandStats.filter(
      (stat) => stat.factor === factor.key
    )) {
      const { band, stats } = bandStat;
      console.log(
        `  ${band.padEnd(7)} | count=${String(stats.count).padStart(3)} | ` +
          `avg 7d α=${String(valueOrDash(stats.avgAlpha7d)).padStart(7)} (n=${stats.sample.alpha7d}) | ` +
          `avg 30d α=${String(valueOrDash(stats.avgAlpha30d)).padStart(7)} (n=${stats.sample.alpha30d}) | ` +
          `7d win=${String(valueOrDash(stats.winRate7d)).padStart(7)} | ` +
          `30d win=${String(valueOrDash(stats.winRate30d)).padStart(7)}`
      );
    }

    console.log("");
  }
}

function printMomentumExtremes(rows: EvaluatedSignalRow[]) {
  const withMomentumAndAlpha30d = rows
    .filter((row) => row.momentumScore != null)
    .map((row) => ({
      ...row,
      alpha30d: calcAlpha(row.return30d, row.spyReturn30d),
    }))
    .filter((row) => row.alpha30d != null)
    .sort((a, b) => (b.momentumScore ?? 0) - (a.momentumScore ?? 0));

  console.log("=== MOMENTUM EXTREMES (top/bottom 5 by momentum, with 30d alpha) ===\n");

  const top = withMomentumAndAlpha30d.slice(0, 5);
  const bottom = withMomentumAndAlpha30d.slice(-5).reverse();

  console.log("Top momentum:");
  for (const row of top) {
    console.log(
      `  ${row.ticker} | momentum ${row.momentumScore} | score ${row.score} | 30d alpha ${row.alpha30d}%`
    );
  }

  console.log("Bottom momentum:");
  for (const row of bottom) {
    console.log(
      `  ${row.ticker} | momentum ${row.momentumScore} | score ${row.score} | 30d alpha ${row.alpha30d}%`
    );
  }

  console.log("");
}

function printBestAndWorstSignals(rows: EvaluatedSignalRow[]) {
  const ranked7dAlpha = rows
    .map((row) => ({
      ...row,
      alpha7d: calcAlpha(row.return7d, row.spyReturn7d),
    }))
    .filter((row) => row.alpha7d != null)
    .sort((a, b) => (b.alpha7d ?? 0) - (a.alpha7d ?? 0));

  console.log("=== TOP 5 SIGNALS BY 7D ALPHA ===\n");
  for (const row of ranked7dAlpha.slice(0, 5)) {
    console.log(
      `${row.ticker} | Score ${row.score} | ${row.politicianName} | 7d Alpha ${row.alpha7d}%`
    );
  }

  console.log("\n=== BOTTOM 5 SIGNALS BY 7D ALPHA ===\n");
  for (const row of ranked7dAlpha.slice(-5)) {
    console.log(
      `${row.ticker} | Score ${row.score} | ${row.politicianName} | 7d Alpha ${row.alpha7d}%`
    );
  }

  console.log("");
}

async function main() {
  console.log("Evaluating signals...");

  const rows = await loadSignals();

  console.log(`Loaded ${rows.length} signals.`);

  const bucketStats = evaluateBuckets(rows);
  const tradeTypeStats = evaluateTradeTypes(rows);
  const factorBandStats = evaluateFactorBands(rows);

  printBucketReport(bucketStats);
  printTradeTypeReport(tradeTypeStats);
  printFactorBandReport(factorBandStats);
  printMomentumExtremes(rows);
  printBestAndWorstSignals(rows);
  await printDiagnostics(rows);

  console.log("Finished evaluating signals.");
}

main().catch((err) => {
  console.error("Signal evaluation failed:", err);
  process.exit(1);
});
