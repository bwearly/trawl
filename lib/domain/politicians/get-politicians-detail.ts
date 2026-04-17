import { db } from "@/lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicianStats,
  politicians,
  researchSignals,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getPoliticianDetail(politicianId: number) {
  const politicianRows = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
      createdAt: politicians.createdAt,

      statsId: politicianStats.id,
      totalDisclosures: politicianStats.totalDisclosures,
      purchaseCount: politicianStats.purchaseCount,
      saleCount: politicianStats.saleCount,
      avgReturn7d: politicianStats.avgReturn7d,
      avgReturn30d: politicianStats.avgReturn30d,
      avgReturn90d: politicianStats.avgReturn90d,
      avgAlpha7d: politicianStats.avgAlpha7d,
      avgAlpha30d: politicianStats.avgAlpha30d,
      avgAlpha90d: politicianStats.avgAlpha90d,
      winRate7d: politicianStats.winRate7d,
      winRate30d: politicianStats.winRate30d,
      winRate90d: politicianStats.winRate90d,
      avgFilingLagDays: politicianStats.avgFilingLagDays,
      lastTradeDate: politicianStats.lastTradeDate,
      statsUpdatedAt: politicianStats.updatedAt,
    })
    .from(politicians)
    .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .where(eq(politicians.id, politicianId))
    .limit(1);

  const politician = politicianRows[0];

  if (!politician) {
    return null;
  }

  const recentDisclosures = await db
    .select({
      id: disclosures.id,
      ticker: disclosures.ticker,
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
    .leftJoin(researchSignals, eq(researchSignals.disclosureId, disclosures.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .where(eq(disclosures.politicianId, politicianId))
    .orderBy(desc(disclosures.tradeDate), desc(disclosures.id))
    .limit(25);

  return {
    politician: {
      id: politician.id,
      fullName: politician.fullName,
      chamber: politician.chamber,
      party: politician.party,
      state: politician.state,
      createdAt: politician.createdAt,
    },
    stats: {
      totalDisclosures: politician.totalDisclosures ?? 0,
      purchaseCount: politician.purchaseCount ?? 0,
      saleCount: politician.saleCount ?? 0,
      avgReturn7d: toNumber(politician.avgReturn7d),
      avgReturn30d: toNumber(politician.avgReturn30d),
      avgReturn90d: toNumber(politician.avgReturn90d),
      avgAlpha7d: toNumber(politician.avgAlpha7d),
      avgAlpha30d: toNumber(politician.avgAlpha30d),
      avgAlpha90d: toNumber(politician.avgAlpha90d),
      winRate7d: toNumber(politician.winRate7d),
      winRate30d: toNumber(politician.winRate30d),
      winRate90d: toNumber(politician.winRate90d),
      avgFilingLagDays: toNumber(politician.avgFilingLagDays),
      lastTradeDate: politician.lastTradeDate,
      updatedAt: politician.statsUpdatedAt,
    },
    recentDisclosures: recentDisclosures.map((row) => {
      const return7d = toNumber(row.return7d);
      const return30d = toNumber(row.return30d);
      const return90d = toNumber(row.return90d);
      const spyReturn7d = toNumber(row.spyReturn7d);
      const spyReturn30d = toNumber(row.spyReturn30d);
      const spyReturn90d = toNumber(row.spyReturn90d);

      return {
        id: row.id,
        ticker: row.ticker,
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
        alpha7d:
          return7d !== null && spyReturn7d !== null
            ? Number((return7d - spyReturn7d).toFixed(2))
            : null,
        alpha30d:
          return30d !== null && spyReturn30d !== null
            ? Number((return30d - spyReturn30d).toFixed(2))
            : null,
        alpha90d:
          return90d !== null && spyReturn90d !== null
            ? Number((return90d - spyReturn90d).toFixed(2))
            : null,
      };
    }),
  };
}