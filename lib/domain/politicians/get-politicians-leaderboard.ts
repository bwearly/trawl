import { db } from "@/lib/db";
import {
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