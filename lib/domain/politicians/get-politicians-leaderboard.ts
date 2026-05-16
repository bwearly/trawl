import { db } from "@/lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicianStats,
  politicians
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export const ACTIVE_LEADERBOARD_LOOKBACK_DAYS = 365;
export const ACTIVE_LEADERBOARD_MIN_DISCLOSURES = 3;

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

type ChamberFilter = "all" | "house" | "senate";

function buildChamberFilter(chamber: ChamberFilter) {
  return chamber === "all" ? undefined : eq(politicians.chamber, chamber);
}

export async function getPoliticianLeaderboard(chamber: ChamberFilter = "all"): Promise<
  PoliticianLeaderboardRow[]
> {
  const chamberFilter = buildChamberFilter(chamber);
  const activeFilter = sql`(
    select count(*)
    from ${disclosures} as d_recent
    where d_recent.politician_id = ${politicians.id}
      and coalesce(d_recent.filing_date, d_recent.trade_date) >= now() - interval '${sql.raw(
        `${ACTIVE_LEADERBOARD_LOOKBACK_DAYS} days`
      )}'
  ) >= ${ACTIVE_LEADERBOARD_MIN_DISCLOSURES}`;

  const baseWhere = chamberFilter ? and(chamberFilter, activeFilter) : activeFilter;
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
    .where(baseWhere)
    .orderBy(
      desc(politicianStats.lastTradeDate),
      desc(sql`COALESCE(${politicianStats.winRate30d}, -999999)`),
      desc(sql`COALESCE(${politicianStats.avgAlpha30d}, -999999)`),
      desc(politicianStats.totalDisclosures),
      politicians.fullName
    );

  if (rows.length === 0) {
    const includeAllDisclosuresForChamber = chamber !== "all";
    const fallbackWhere = chamberFilter
      ? and(
          chamberFilter,
          includeAllDisclosuresForChamber ? sql`true` : activeFilter
        )
      : activeFilter;
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
        avgAlpha30d: sql<number | null>`round(avg(case
          when ${disclosurePerformanceWindows.return30d} is not null
            and ${disclosurePerformanceWindows.spyReturn30d} is not null
          then ${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}
          else null
        end), 2)`,
        winRate30d: sql<number | null>`round(100.0 * avg(case
          when ${disclosurePerformanceWindows.return30d} is not null
            and ${disclosurePerformanceWindows.spyReturn30d} is not null
          then case
            when (${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}) > 0 then 1.0
            else 0.0
          end
          else null
        end), 2)`,
        avgFilingLagDays: sql<number | null>`avg(${disclosures.filingLagDays})`,
        lastTradeDate: sql<Date | null>`max(${disclosures.tradeDate})`,
      })
      .from(politicians)
      .innerJoin(disclosures, eq(disclosures.politicianId, politicians.id))
      .leftJoin(
        disclosurePerformanceWindows,
        eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
      )
      .where(fallbackWhere)
      .groupBy(
        politicians.id,
        politicians.fullName,
        politicians.chamber,
        politicians.party,
        politicians.state
      )
      .having(
        includeAllDisclosuresForChamber
          ? sql`count(${disclosures.id}) >= 1`
          : sql`count(${disclosures.id}) >= ${ACTIVE_LEADERBOARD_MIN_DISCLOSURES}`
      )
      .orderBy(
        desc(sql`max(${disclosures.tradeDate})`),
        desc(sql`COALESCE(round(100.0 * avg(case
          when ${disclosurePerformanceWindows.return30d} is not null
            and ${disclosurePerformanceWindows.spyReturn30d} is not null
          then case
            when (${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}) > 0 then 1.0
            else 0.0
          end
          else null
        end), 2), -999999)`),
        desc(sql`COALESCE(round(avg(case
          when ${disclosurePerformanceWindows.return30d} is not null
            and ${disclosurePerformanceWindows.spyReturn30d} is not null
          then ${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}
          else null
        end), 2), -999999)`),
        desc(sql`count(${disclosures.id})`),
        politicians.fullName
      );

    return fallbackRows.map((row) => ({
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

export async function getPoliticianDisclosureCountForChamber(
  chamber: ChamberFilter
): Promise<number> {
  const chamberFilter = buildChamberFilter(chamber);
  const whereClause = chamberFilter ? chamberFilter : sql`true`;
  const result = await db
    .select({ count: sql<number>`count(${disclosures.id})` })
    .from(disclosures)
    .innerJoin(politicians, eq(disclosures.politicianId, politicians.id))
    .where(whereClause);

  return Number(result[0]?.count ?? 0);
}
