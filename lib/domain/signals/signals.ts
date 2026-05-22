import { and, asc, desc, eq, gte, ilike, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicianStats,
  politicians,
  researchSignals,
} from "@/lib/db/schema";
import { getFilingFreshnessLabel } from "@/lib/domain/signals/filing-freshness";
import { scoreSignal } from "@/lib/domain/scoring/scoreSignals";

export type SignalFilters = {
  minScore: "0" | "50" | "70" | "80";
  tradeType: "all" | "purchase" | "sale" | "exchange";
  party: "all" | "Democrat" | "Republican" | "Independent";
  chamber: "all" | "house" | "senate";
  ticker: string;
  politician: string;
  freshness:
    | "all"
    | "fresh"
    | "normal"
    | "delayed"
    | "stale"
    | "historical"
    | "unknown";
  sort:
    | "current"
    | "score"
    | "newest"
    | "filingLagAsc"
    | "filingLagDesc"
    | "ticker"
    | "politician"
    | "tradeType"
    | "freshness";
  assetCoverage: "tickerOnly" | "allDisclosures";
};

export type SignalRow = {
  signalId: number;
  ticker: string | null;
  score: string;
  signalStatus: string;
  primaryReason: string | null;
  reasonSummary: string | null;
  politicianId: number;
  politicianName: string;
  chamber: string | null;
  tradeType: string;
  ownerType: string;
  amountRangeLabel: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
  filingLagDays: number | null;
  filingFreshnessLabel: "Fresh" | "Normal" | "Delayed" | "Stale" | "Historical" | "Unknown";
  return7d: string | null;
  return30d: string | null;
  spyReturn7d: string | null;
  spyReturn30d: string | null;
  historicalSampleSize: number | null;
  sourceUrl: string | null;
  signalDate: Date;
  performanceScore: string | null;
  signalStage: string;
};

const MIN_SCORE_OPTIONS = new Set<SignalFilters["minScore"]>(["0", "50", "70", "80"]);
const TRADE_TYPE_OPTIONS = new Set<SignalFilters["tradeType"]>([
  "all",
  "purchase",
  "sale",
  "exchange",
]);
const PARTY_OPTIONS = new Set<SignalFilters["party"]>([
  "all",
  "Democrat",
  "Republican",
  "Independent",
]);
const CHAMBER_OPTIONS = new Set<SignalFilters["chamber"]>(["all", "house", "senate"]);
const FRESHNESS_OPTIONS = new Set<SignalFilters["freshness"]>([
  "all",
  "fresh",
  "normal",
  "delayed",
  "stale",
  "historical",
  "unknown",
]);
const SORT_OPTIONS = new Set<SignalFilters["sort"]>([
  "current",
  "score",
  "newest",
  "filingLagAsc",
  "filingLagDesc",
  "ticker",
  "politician",
  "tradeType",
  "freshness",
]);
const ASSET_COVERAGE_OPTIONS = new Set<SignalFilters["assetCoverage"]>([
  "tickerOnly",
  "allDisclosures",
]);

export function parseSignalSort(rawSort: string | undefined): SignalFilters["sort"] {
  return SORT_OPTIONS.has(rawSort as SignalFilters["sort"])
    ? (rawSort as SignalFilters["sort"])
     : "current";
}

export const DEFAULT_SIGNAL_FILTERS: SignalFilters = {
  minScore: "0",
  tradeType: "all",
  party: "all",
  chamber: "all",
  ticker: "",
  politician: "",
  freshness: "all",
  sort: "current",
  assetCoverage: "tickerOnly",
};

export function parseSignalFilters(raw: Partial<Record<keyof SignalFilters, string>>): SignalFilters {
  const minScore = MIN_SCORE_OPTIONS.has(raw.minScore as SignalFilters["minScore"])
    ? (raw.minScore as SignalFilters["minScore"])
    : DEFAULT_SIGNAL_FILTERS.minScore;

  const tradeType = TRADE_TYPE_OPTIONS.has(raw.tradeType as SignalFilters["tradeType"])
    ? (raw.tradeType as SignalFilters["tradeType"])
    : DEFAULT_SIGNAL_FILTERS.tradeType;

  const party = PARTY_OPTIONS.has(raw.party as SignalFilters["party"])
    ? (raw.party as SignalFilters["party"])
    : DEFAULT_SIGNAL_FILTERS.party;

  const sort = parseSignalSort(raw.sort);
  const chamber = CHAMBER_OPTIONS.has(raw.chamber as SignalFilters["chamber"])
    ? (raw.chamber as SignalFilters["chamber"])
    : DEFAULT_SIGNAL_FILTERS.chamber;
  const freshness = FRESHNESS_OPTIONS.has(raw.freshness as SignalFilters["freshness"])
    ? (raw.freshness as SignalFilters["freshness"])
    : DEFAULT_SIGNAL_FILTERS.freshness;
  const assetCoverage = ASSET_COVERAGE_OPTIONS.has(
    raw.assetCoverage as SignalFilters["assetCoverage"]
  )
    ? (raw.assetCoverage as SignalFilters["assetCoverage"])
    : DEFAULT_SIGNAL_FILTERS.assetCoverage;

  return {
    minScore,
    tradeType,
    party,
    chamber,
    ticker: raw.ticker?.trim() ?? DEFAULT_SIGNAL_FILTERS.ticker,
    politician: raw.politician?.trim() ?? DEFAULT_SIGNAL_FILTERS.politician,
    freshness,
    sort,
    assetCoverage,
  };
}

export async function getSignals(filters: SignalFilters): Promise<SignalRow[]> {
  const whereFilters = [];

  const minScoreNumber = Number(filters.minScore);
  if (minScoreNumber > 0) {
    whereFilters.push(gte(researchSignals.score, String(minScoreNumber)));
  }

  if (filters.tradeType !== "all") {
    whereFilters.push(eq(disclosures.tradeType, filters.tradeType));
  }

  if (filters.party !== "all") {
    whereFilters.push(eq(politicians.party, filters.party));
  }
  if (filters.chamber !== "all") {
    whereFilters.push(eq(politicians.chamber, filters.chamber));
  }
  if (filters.ticker) {
    whereFilters.push(ilike(researchSignals.ticker, `%${filters.ticker}%`));
  }
  if (filters.politician) {
    whereFilters.push(ilike(politicians.fullName, `%${filters.politician}%`));
  }
  if (filters.assetCoverage === "tickerOnly") {
    whereFilters.push(sql`nullif(trim(${researchSignals.ticker}), '') is not null`);
  }
  if (filters.freshness === "fresh") {
    whereFilters.push(sql`${disclosures.filingLagDays} <= 15`);
  } else if (filters.freshness === "normal") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 15 and ${disclosures.filingLagDays} <= 45`);
  } else if (filters.freshness === "delayed") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 45 and ${disclosures.filingLagDays} <= 90`);
  } else if (filters.freshness === "stale") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 90 and ${disclosures.filingLagDays} <= 365`);
  } else if (filters.freshness === "historical") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 365`);
  } else if (filters.freshness === "unknown") {
    whereFilters.push(isNull(disclosures.filingLagDays));
  }

  const scoreDesc = desc(researchSignals.score);
  const signalDateDesc = desc(researchSignals.signalDate);
  const filingDateDesc = desc(disclosures.filingDate);
  const filingLagNullsLast = sql`${disclosures.filingLagDays} IS NULL`;
  const freshnessRank = sql<number>`case
    when ${disclosures.filingLagDays} <= 15 then 1
    when ${disclosures.filingLagDays} > 15 and ${disclosures.filingLagDays} <= 45 then 2
    when ${disclosures.filingLagDays} > 45 and ${disclosures.filingLagDays} <= 90 then 3
    when ${disclosures.filingLagDays} > 90 and ${disclosures.filingLagDays} <= 365 then 4
    when ${disclosures.filingLagDays} > 365 then 5
    else 6
  end`;

  const orderBy =
    filters.sort === "current"
      ? [asc(freshnessRank), filingDateDesc, scoreDesc, signalDateDesc]
      : filters.sort === "newest"
      ? [filingDateDesc, signalDateDesc, scoreDesc]
      : filters.sort === "filingLagAsc"
      ? [asc(filingLagNullsLast), asc(disclosures.filingLagDays), scoreDesc, signalDateDesc]
      : filters.sort === "filingLagDesc"
      ? [asc(filingLagNullsLast), desc(disclosures.filingLagDays), scoreDesc, signalDateDesc]
      : filters.sort === "freshness"
      ? [asc(freshnessRank), scoreDesc, signalDateDesc]
      : filters.sort === "ticker"
      ? [asc(researchSignals.ticker), scoreDesc, signalDateDesc]
      : filters.sort === "politician"
      ? [asc(politicians.fullName), scoreDesc, signalDateDesc]
      : filters.sort === "tradeType"
      ? [asc(disclosures.tradeType), scoreDesc, signalDateDesc]
      : [scoreDesc, filingDateDesc, signalDateDesc];

  return db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      politicianName: politicians.fullName,
      politicianId: politicians.id,
      chamber: politicians.chamber,
      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountRangeLabel: disclosures.amountRangeLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
      spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
      historicalSampleSize: politicianStats.totalDisclosures,
      sourceUrl: disclosures.sourceUrl,
      signalDate: researchSignals.signalDate,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .where(whereFilters.length ? and(...whereFilters) : undefined)
    .orderBy(...orderBy)
    .then((rows) =>
      rows.map((row) => {
        const daysSinceFiling = row.filingDate
          ? Math.floor((Date.now() - row.filingDate.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const scored = scoreSignal({
          tradeType: row.tradeType,
          amountMin: null,
          amountMax: null,
          filingLagDays: row.filingLagDays,
          daysSinceFiling,
          return7d: row.return7d,
          spyReturn7d: row.spyReturn7d,
          return30d: row.return30d,
          spyReturn30d: row.spyReturn30d,
        });
        return {
          ...row,
          filingFreshnessLabel: getFilingFreshnessLabel(row.filingLagDays),
          performanceScore: scored.performanceScore == null ? null : scored.performanceScore.toFixed(2),
          signalStage: scored.signalStage,
        };
      })
    );
}
