import { db } from "@/lib/db";
import {
  disclosures,
  politicianStats,
  politicians
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type PoliticianLeaderboardRow = {
  id: number;
  fullName: string;
  chamber: string;
  party: string | null;
  state: string | null;
  totalDisclosures: number;
  purchaseCount: number;
  saleCount: number;
  avgAlpha30d: number | null;
  winRate30d: number | null;
  avgFilingLagDays: number | null;
  lastTradeDate: Date | null;
};

export async function getPoliticianLeaderboard(): Promise<
  PoliticianLeaderboardRow[]
> {
  const rows = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
      totalDisclosures: politicianStats.totalDisclosures,
      purchaseCount: politicianStats.purchaseCount,
      saleCount: politicianStats.saleCount,
      avgAlpha30d: politicianStats.avgAlpha30d,
      winRate30d: politicianStats.winRate30d,
      avgFilingLagDays: politicianStats.avgFilingLagDays,
      lastTradeDate: politicianStats.lastTradeDate,
    })
    .from(politicians)
    .innerJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .orderBy(
      desc(sql`COALESCE(${politicianStats.avgAlpha30d}, -999999)`),
      desc(sql`COALESCE(${politicianStats.winRate30d}, -999999)`),
      desc(politicianStats.totalDisclosures),
      politicians.fullName
    );

  if (rows.length === 0) {
    const fallbackRows = await db
      .select({
        id: politicians.id,
        fullName: politicians.fullName,
        chamber: politicians.chamber,
        party: politicians.party,
        state: politicians.state,
        totalDisclosures: sql<number>`count(${disclosures.id})`,
        purchaseCount: sql<number>`sum(case when ${disclosures.tradeType} = 'purchase' then 1 else 0 end)`,
        saleCount: sql<number>`sum(case when ${disclosures.tradeType} = 'sale' then 1 else 0 end)`,
        avgAlpha30d: sql<null>`null`,
        winRate30d: sql<null>`null`,
        avgFilingLagDays: sql<number | null>`avg(${disclosures.filingLagDays})`,
        lastTradeDate: sql<Date | null>`max(${disclosures.tradeDate})`,
      })
      .from(politicians)
      .innerJoin(disclosures, eq(disclosures.politicianId, politicians.id))
      .groupBy(
        politicians.id,
        politicians.fullName,
        politicians.chamber,
        politicians.party,
        politicians.state
      )
      .orderBy(desc(sql`count(${disclosures.id})`), politicians.fullName);

    return fallbackRows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      chamber: row.chamber,
      party: row.party,
      state: row.state,
      totalDisclosures: row.totalDisclosures,
      purchaseCount: row.purchaseCount,
      saleCount: row.saleCount,
      avgAlpha30d: null,
      winRate30d: null,
      avgFilingLagDays: toNumber(row.avgFilingLagDays),
      lastTradeDate: row.lastTradeDate,
    }));
  }

  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    chamber: row.chamber,
    party: row.party,
    state: row.state,
    totalDisclosures: row.totalDisclosures,
    purchaseCount: row.purchaseCount,
    saleCount: row.saleCount,
    avgAlpha30d: toNumber(row.avgAlpha30d),
    winRate30d: toNumber(row.winRate30d),
    avgFilingLagDays: toNumber(row.avgFilingLagDays),
    lastTradeDate: row.lastTradeDate,
  }));
}
