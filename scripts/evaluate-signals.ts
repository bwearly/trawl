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

function calcAlpha(
  stockReturn: number | null,
  benchmarkReturn: number | null
): number | null {
  if (stockReturn == null || benchmarkReturn == null) return null;
  return round2(stockReturn - benchmarkReturn);
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
  }));
}

function evaluateBuckets(rows: EvaluatedSignalRow[]): BucketStats[] {
  const bucketOrder: BucketKey[] = ["0-39", "40-59", "60-79", "80-100"];

  return bucketOrder.map((bucket) => {
    const bucketRows = rows.filter((row) => getBucket(row.score) === bucket);

    const returns7d = bucketRows
      .map((row) => row.return7d)
      .filter((value): value is number => value != null);

    const returns30d = bucketRows
      .map((row) => row.return30d)
      .filter((value): value is number => value != null);

    const alpha7d = bucketRows
      .map((row) => calcAlpha(row.return7d, row.spyReturn7d))
      .filter((value): value is number => value != null);

    const alpha30d = bucketRows
      .map((row) => calcAlpha(row.return30d, row.spyReturn30d))
      .filter((value): value is number => value != null);

    return {
      bucket,
      count: bucketRows.length,
      avgReturn7d: average(returns7d),
      avgReturn30d: average(returns30d),
      avgAlpha7d: average(alpha7d),
      avgAlpha30d: average(alpha30d),
      winRate7d: winRate(returns7d),
      winRate30d: winRate(returns30d),
    };
  });
}

function printBucketReport(stats: BucketStats[]) {
  console.log("\n=== SCORE BUCKET REPORT ===\n");

  for (const stat of stats) {
    console.log(`Bucket ${stat.bucket}`);
    console.log(`  Count: ${stat.count}`);
    console.log(`  Avg 7d Return: ${stat.avgReturn7d ?? "—"}%`);
    console.log(`  Avg 30d Return: ${stat.avgReturn30d ?? "—"}%`);
    console.log(`  Avg 7d Alpha: ${stat.avgAlpha7d ?? "—"}%`);
    console.log(`  Avg 30d Alpha: ${stat.avgAlpha30d ?? "—"}%`);
    console.log(`  7d Win Rate: ${stat.winRate7d ?? "—"}%`);
    console.log(`  30d Win Rate: ${stat.winRate30d ?? "—"}%`);
    console.log("");
  }
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
  printBucketReport(bucketStats);
  printBestAndWorstSignals(rows);

  console.log("Finished evaluating signals.");
}

main().catch((err) => {
  console.error("Signal evaluation failed:", err);
  process.exit(1);
});