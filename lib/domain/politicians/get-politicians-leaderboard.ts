import { db } from "@/lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicianStats,
  politicians
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { computeLeaderboardScore } from "@/lib/domain/politicians/leaderboard-score";

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
  validPerformanceCount: number;
  leaderboardScore: number;
};

type ChamberFilter = "all" | "house" | "senate";
type CoverageFilter = "active" | "all-members";

function buildChamberFilter(chamber: ChamberFilter) {
  return chamber === "all" ? undefined : eq(politicians.chamber, chamber);
}

export async function getPoliticianLeaderboard(chamber: ChamberFilter = "all", coverage: CoverageFilter = "active"): Promise<
  PoliticianLeaderboardRow[]
> {
  const chamberFilter = buildChamberFilter(chamber);
  const normalize = (row: Omit<PoliticianLeaderboardRow, "avgAlpha30d" | "winRate30d" | "avgFilingLagDays" | "leaderboardScore"> & { avgAlpha30d: number | null; winRate30d: number | null; avgFilingLagDays: number | null; }) => ({
    ...row,
    leaderboardScore: computeLeaderboardScore({
      avgAlpha30d: row.avgAlpha30d,
      winRate30d: row.winRate30d,
      totalDisclosures: row.totalDisclosures,
      validPerformanceCount: row.validPerformanceCount,
      avgFilingLagDays: row.avgFilingLagDays,
    }),
  });

  if (coverage === "all-members") {
    const allWhere = chamberFilter ?? sql`true`;
    const rows = await db
      .select({
        id: politicians.id,
        fullName: politicians.fullName,
        chamber: politicians.chamber,
        party: politicians.party,
        state: politicians.state,
        totalDisclosures: sql<number>`coalesce(${politicianStats.totalDisclosures}, 0)`,
        purchaseCount: sql<number>`coalesce(${politicianStats.purchaseCount}, 0)`,
        saleCount: sql<number>`coalesce(${politicianStats.saleCount}, 0)`,
        avgAlpha30d: politicianStats.avgAlpha30d,
        winRate30d: politicianStats.winRate30d,
        avgFilingLagDays: politicianStats.avgFilingLagDays,
        lastTradeDate: politicianStats.lastTradeDate,
        validPerformanceCount: sql<number>`(
          select count(*)::int
          from ${disclosures} d
          inner join ${disclosurePerformanceWindows} p on p.disclosure_id = d.id
          where d.politician_id = ${politicians.id}
            and p.return_30d is not null
            and p.spy_return_30d is not null
        )`,
      })
      .from(politicians)
      .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
      .where(allWhere)
      .orderBy(politicians.fullName);

    return rows
      .map((row) => normalize({
        id: row.id,
        fullName: row.fullName,
        chamber: row.chamber,
        party: row.party,
        state: row.state,
        totalDisclosures: Number(row.totalDisclosures ?? 0),
        purchaseCount: Number(row.purchaseCount ?? 0),
        saleCount: Number(row.saleCount ?? 0),
        avgAlpha30d: toNumber(row.avgAlpha30d),
        winRate30d: toNumber(row.winRate30d),
        avgFilingLagDays: toNumber(row.avgFilingLagDays),
        lastTradeDate: row.lastTradeDate,
        validPerformanceCount: Number(row.validPerformanceCount ?? 0),
      }))
      .sort((a, b) => (Number(b.totalDisclosures > 0) - Number(a.totalDisclosures > 0)) || b.leaderboardScore - a.leaderboardScore || b.totalDisclosures - a.totalDisclosures || a.fullName.localeCompare(b.fullName));
  }

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
      validPerformanceCount: sql<number>`(
        select count(*)::int
        from ${disclosures} d
        inner join ${disclosurePerformanceWindows} p on p.disclosure_id = d.id
        where d.politician_id = ${politicians.id}
          and p.return_30d is not null
          and p.spy_return_30d is not null
      )`,
    })
    .from(politicians)
    .innerJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .where(baseWhere)
    .orderBy(desc(politicianStats.totalDisclosures), politicians.fullName);

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
        avgAlpha30d: sql<number | null>`round(avg(case when ${disclosurePerformanceWindows.return30d} is not null and ${disclosurePerformanceWindows.spyReturn30d} is not null then ${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d} else null end), 2)`,
        winRate30d: sql<number | null>`round(100.0 * avg(case when ${disclosurePerformanceWindows.return30d} is not null and ${disclosurePerformanceWindows.spyReturn30d} is not null then case when (${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}) > 0 then 1.0 else 0.0 end else null end), 2)`,
        avgFilingLagDays: sql<number | null>`avg(${disclosures.filingLagDays})`,
        lastTradeDate: sql<Date | null>`max(${disclosures.tradeDate})`,
        validPerformanceCount: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return30d} is not null and ${disclosurePerformanceWindows.spyReturn30d} is not null)::int`,
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
      );

    return fallbackRows
      .map((row) => normalize({
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
        validPerformanceCount: Number(row.validPerformanceCount ?? 0),
      }))
      .sort((a, b) => b.leaderboardScore - a.leaderboardScore || b.validPerformanceCount - a.validPerformanceCount || b.totalDisclosures - a.totalDisclosures || ((b.lastTradeDate?.getTime() ?? 0) - (a.lastTradeDate?.getTime() ?? 0)) || a.fullName.localeCompare(b.fullName));
  }

  return rows
    .map((row) => normalize({
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
      validPerformanceCount: Number(row.validPerformanceCount ?? 0),
    }))
    .sort((a, b) => b.leaderboardScore - a.leaderboardScore || b.validPerformanceCount - a.validPerformanceCount || b.totalDisclosures - a.totalDisclosures || ((b.lastTradeDate?.getTime() ?? 0) - (a.lastTradeDate?.getTime() ?? 0)) || a.fullName.localeCompare(b.fullName));
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
