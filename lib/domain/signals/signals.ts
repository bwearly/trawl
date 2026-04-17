import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";

export type SignalFilters = {
  minScore: "0" | "50" | "70" | "80";
  tradeType: "all" | "purchase" | "sale" | "exchange";
  party: "all" | "Democrat" | "Republican" | "Independent";
  sort: "score" | "newest";
};

export type SignalRow = {
  signalId: number;
  ticker: string;
  score: string;
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
const SORT_OPTIONS = new Set<SignalFilters["sort"]>(["score", "newest"]);

export const DEFAULT_SIGNAL_FILTERS: SignalFilters = {
  minScore: "0",
  tradeType: "all",
  party: "all",
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

  return {
    minScore,
    tradeType,
    party,
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

  return db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
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
      sourceUrl: disclosures.sourceUrl,
      signalDate: researchSignals.signalDate,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(whereFilters.length ? and(...whereFilters) : undefined)
    .orderBy(
      filters.sort === "newest"
        ? desc(researchSignals.signalDate)
        : desc(researchSignals.score)
    );
}
