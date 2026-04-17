import { db } from "@/lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicians,
  researchSignals,
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function winRate(values: number[]): number | null {
  if (!values.length) return null;
  const wins = values.filter((value) => value > 0).length;
  return Number(((wins / values.length) * 100).toFixed(2));
}

function normalizeTicker(symbol: string) {
  return symbol.trim().toUpperCase();
}

export async function getTickerDetail(symbol: string) {
  const ticker = normalizeTicker(symbol);

  const disclosureRows = await db
    .select({
      id: disclosures.id,
      politicianId: disclosures.politicianId,
      politicianName: politicians.fullName,
      politicianParty: politicians.party,
      politicianState: politicians.state,
      assetName: disclosures.assetName,
      assetType: disclosures.assetType,
      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountMin: disclosures.amountMin,
      amountMax: disclosures.amountMax,
      amountRangeLabel: disclosures.amountRangeLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      sourceUrl: disclosures.sourceUrl,
      sourceLabel: disclosures.sourceLabel,

      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      primaryReason: researchSignals.primaryReason,

      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      return90d: disclosurePerformanceWindows.return90d,
      spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
      spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
      spyReturn90d: disclosurePerformanceWindows.spyReturn90d,
    })
    .from(disclosures)
    .innerJoin(politicians, eq(politicians.id, disclosures.politicianId))
    .leftJoin(researchSignals, eq(researchSignals.disclosureId, disclosures.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .where(and(eq(disclosures.ticker, ticker)))
    .orderBy(desc(disclosures.tradeDate), desc(disclosures.id));

  if (!disclosureRows.length) {
    return null;
  }

  const firstNamedAsset = disclosureRows.find((row) => row.assetName)?.assetName ?? ticker;

  const return7dValues: number[] = [];
  const return30dValues: number[] = [];
  const return90dValues: number[] = [];

  const alpha7dValues: number[] = [];
  const alpha30dValues: number[] = [];
  const alpha90dValues: number[] = [];

  const filingLagValues: number[] = [];

  let purchaseCount = 0;
  let saleCount = 0;
  let exchangeCount = 0;
  let lastTradeDate: Date | null = null;

  const recentDisclosures = disclosureRows.map((row) => {
    const return7d = toNumber(row.return7d);
    const return30d = toNumber(row.return30d);
    const return90d = toNumber(row.return90d);

    const spyReturn7d = toNumber(row.spyReturn7d);
    const spyReturn30d = toNumber(row.spyReturn30d);
    const spyReturn90d = toNumber(row.spyReturn90d);

    const alpha7d =
      return7d !== null && spyReturn7d !== null
        ? Number((return7d - spyReturn7d).toFixed(2))
        : null;

    const alpha30d =
      return30d !== null && spyReturn30d !== null
        ? Number((return30d - spyReturn30d).toFixed(2))
        : null;

    const alpha90d =
      return90d !== null && spyReturn90d !== null
        ? Number((return90d - spyReturn90d).toFixed(2))
        : null;

    if (row.tradeType === "purchase") purchaseCount += 1;
    else if (row.tradeType === "sale") saleCount += 1;
    else if (row.tradeType === "exchange") exchangeCount += 1;

    if (row.filingLagDays !== null) {
      filingLagValues.push(row.filingLagDays);
    }

    if (return7d !== null) return7dValues.push(return7d);
    if (return30d !== null) return30dValues.push(return30d);
    if (return90d !== null) return90dValues.push(return90d);

    if (alpha7d !== null) alpha7dValues.push(alpha7d);
    if (alpha30d !== null) alpha30dValues.push(alpha30d);
    if (alpha90d !== null) alpha90dValues.push(alpha90d);

    if (row.tradeDate && (!lastTradeDate || row.tradeDate > lastTradeDate)) {
      lastTradeDate = row.tradeDate;
    }

    return {
      id: row.id,
      politicianId: row.politicianId,
      politicianName: row.politicianName,
      politicianParty: row.politicianParty,
      politicianState: row.politicianState,
      assetName: row.assetName,
      assetType: row.assetType,
      tradeType: row.tradeType,
      ownerType: row.ownerType,
      amountMin: row.amountMin,
      amountMax: row.amountMax,
      amountRangeLabel: row.amountRangeLabel,
      tradeDate: row.tradeDate,
      filingDate: row.filingDate,
      filingLagDays: row.filingLagDays,
      sourceUrl: row.sourceUrl,
      sourceLabel: row.sourceLabel,
      score: toNumber(row.score),
      signalStatus: row.signalStatus,
      primaryReason: row.primaryReason,
      return7d,
      return30d,
      return90d,
      spyReturn7d,
      spyReturn30d,
      spyReturn90d,
      alpha7d,
      alpha30d,
      alpha90d,
    };
  });

  const uniquePoliticians = new Set(disclosureRows.map((row) => row.politicianId)).size;

  return {
    ticker,
    assetName: firstNamedAsset,
    stats: {
      totalDisclosures: disclosureRows.length,
      uniquePoliticians,
      purchaseCount,
      saleCount,
      exchangeCount,
      avgReturn7d: average(return7dValues),
      avgReturn30d: average(return30dValues),
      avgReturn90d: average(return90dValues),
      avgAlpha7d: average(alpha7dValues),
      avgAlpha30d: average(alpha30dValues),
      avgAlpha90d: average(alpha90dValues),
      winRate7d: winRate(alpha7dValues),
      winRate30d: winRate(alpha30dValues),
      winRate90d: winRate(alpha90dValues),
      avgFilingLagDays: average(filingLagValues),
      lastTradeDate,
    },
    recentDisclosures: recentDisclosures.slice(0, 50),
  };
}