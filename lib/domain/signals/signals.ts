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

export type SignalFilters = {
  minScore: "0" | "50" | "70" | "80";
  tradeType: "all" | "purchase" | "sale" | "exchange";
  party: "all" | "Democrat" | "Republican" | "Independent";
  ticker: string;
  politician: string;
  freshness: "all" | "fresh" | "normal" | "delayed" | "stale" | "unknown";
  sort:
    | "score"
    | "newest"
    | "filingLagAsc"
    | "filingLagDesc"
    | "ticker"
    | "politician"
    | "tradeType"
    | "freshness";
};

export type SignalRow = {
  signalId: number;
  ticker: string;
  score: string;
  signalStatus: string;
  primaryReason: string | null;
  reasonSummary: string | null;
  politicianId: number;
  politicianName: string;
  tradeType: string;
  ownerType: string;
  amountRangeLabel: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
  filingLagDays: number | null;
  filingFreshnessLabel: "Fresh" | "Normal" | "Delayed" | "Stale" | "Unknown";
  return7d: string | null;
  return30d: string | null;
  historicalSampleSize: number | null;
  sourceUrl: string | null;
  signalDate: Date;
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
const FRESHNESS_OPTIONS = new Set<SignalFilters["freshness"]>([
  "all",
  "fresh",
  "normal",
  "delayed",
  "stale",
  "unknown",
]);
const SORT_OPTIONS = new Set<SignalFilters["sort"]>([
  "score",
  "newest",
  "filingLagAsc",
  "filingLagDesc",
  "ticker",
  "politician",
  "tradeType",
  "freshness",
]);

export const DEFAULT_SIGNAL_FILTERS: SignalFilters = {
  minScore: "0",
  tradeType: "all",
  party: "all",
  ticker: "",
  politician: "",
  freshness: "all",
  sort: "score",
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

  const sort = SORT_OPTIONS.has(raw.sort as SignalFilters["sort"])
    ? (raw.sort as SignalFilters["sort"])
    : DEFAULT_SIGNAL_FILTERS.sort;
  const freshness = FRESHNESS_OPTIONS.has(raw.freshness as SignalFilters["freshness"])
    ? (raw.freshness as SignalFilters["freshness"])
    : DEFAULT_SIGNAL_FILTERS.freshness;

  return {
    minScore,
    tradeType,
    party,
    ticker: raw.ticker?.trim() ?? DEFAULT_SIGNAL_FILTERS.ticker,
    politician: raw.politician?.trim() ?? DEFAULT_SIGNAL_FILTERS.politician,
    freshness,
    sort,
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
  if (filters.ticker) {
    whereFilters.push(ilike(researchSignals.ticker, `%${filters.ticker}%`));
  }
  if (filters.politician) {
    whereFilters.push(ilike(politicians.fullName, `%${filters.politician}%`));
  }
  if (filters.freshness === "fresh") {
    whereFilters.push(sql`${disclosures.filingLagDays} <= 15`);
  } else if (filters.freshness === "normal") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 15 and ${disclosures.filingLagDays} <= 45`);
  } else if (filters.freshness === "delayed") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 45 and ${disclosures.filingLagDays} <= 90`);
  } else if (filters.freshness === "stale") {
    whereFilters.push(sql`${disclosures.filingLagDays} > 90`);
  } else if (filters.freshness === "unknown") {
    whereFilters.push(isNull(disclosures.filingLagDays));
  }

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
      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountRangeLabel: disclosures.amountRangeLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
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
    .orderBy(
      filters.sort === "newest"
        ? desc(researchSignals.signalDate)
        : filters.sort === "filingLagAsc" || filters.sort === "freshness"
        ? asc(disclosures.filingLagDays)
        : filters.sort === "filingLagDesc"
        ? desc(disclosures.filingLagDays)
        : filters.sort === "ticker"
        ? asc(researchSignals.ticker)
        : filters.sort === "politician"
        ? asc(politicians.fullName)
        : filters.sort === "tradeType"
        ? asc(disclosures.tradeType)
        : desc(researchSignals.score),
      desc(researchSignals.signalDate)
    )
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        filingFreshnessLabel: getFilingFreshnessLabel(row.filingLagDays),
      }))
    );
}
