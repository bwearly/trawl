import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicians,
  researchSignals,
} from "../lib/db/schema";
import { eq } from "drizzle-orm";

type EvaluatedSignalRow = {
  signalId: number;
  ticker: string;
  score: number;
  tradeType: string;
  politicianName: string;
  party: string | null;
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
    rangeLabel: "0-15",
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
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      tradeType: disclosures.tradeType,
      politicianName: politicians.fullName,
      party: politicians.party,
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
    ticker: row.ticker,
    score: Number(row.score),
    tradeType: row.tradeType,
    politicianName: row.politicianName,
    party: row.party,
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

  console.log("Finished evaluating signals.");
}

main().catch((err) => {
  console.error("Signal evaluation failed:", err);
  process.exit(1);
});
