import { config } from "dotenv";
config({ path: ".env.local" });

import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  alerts,
  disclosurePerformanceWindows,
  disclosures,
  politicians,
  researchSignals,
} from "../lib/db/schema";

const HOUSE_SOURCE_LABEL = "House Clerk Financial Disclosure";

type UnknownTickerRow = {
  ticker: string | null;
  count: number;
};

type FilingLagSampleRow = {
  disclosureId: number;
  ticker: string | null;
  politician: string;
  tradeDate: Date;
  filingDate: Date;
  filingLagDays: number;
};

type SourceLabelCountRow = {
  sourceLabel: string;
  count: number;
};

function parseNumeric(value: unknown): number {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function hasAllSourcesFlag(argv: string[]): boolean {
  return argv.includes("--all-sources");
}

function hasCleanupDuplicatesFlag(argv: string[]): boolean {
  return argv.includes("--cleanup-duplicates");
}

function sourceScopeCondition(allSources: boolean) {
  return allSources ? sql`true` : eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL);
}

function scoreAssetNameQuality(assetName: string | null): number {
  const value = (assetName ?? "").trim();
  if (value.length === 0) return 0;
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  return Math.min(80, value.length) + Math.min(40, tokenCount * 4);
}

async function getFilingLagRange(allSources: boolean) {
  const filingLagDaysExpr = sql<number>`(${disclosures.filingDate}::date - ${disclosures.tradeDate}::date)`;

  const result = await db
    .select({
      minLag: sql<number | null>`min(${filingLagDaysExpr})`,
      maxLag: sql<number | null>`max(${filingLagDaysExpr})`,
      avgLag: sql<number | null>`avg(${filingLagDaysExpr})`,
      count: sql<number>`count(*)`,
    })
    .from(disclosures)
    .where(
      and(
        sourceScopeCondition(allSources),
        sql`${disclosures.tradeDate} is not null`,
        sql`${disclosures.filingDate} is not null`
      )
    );

  return {
    minLag: result[0]?.minLag ?? null,
    maxLag: result[0]?.maxLag ?? null,
    avgLag: result[0]?.avgLag ?? null,
    count: parseNumeric(result[0]?.count),
  };
}

async function cleanupHouseDuplicateDisclosures(): Promise<void> {
  const duplicateGroups = await db.execute(sql`
    with duplicate_groups as (
      select
        d.politician_id,
        upper(coalesce(d.ticker, 'NULL')) as ticker_key,
        d.trade_type,
        d.trade_date::date as trade_date_key,
        d.filing_date::date as filing_date_key,
        coalesce(d.amount_range_label, 'NULL') as amount_key,
        array_agg(d.id order by d.id asc) as disclosure_ids
      from disclosures d
      where d.source_label = ${HOUSE_SOURCE_LABEL}
      group by
        d.politician_id,
        upper(coalesce(d.ticker, 'NULL')),
        d.trade_type,
        d.trade_date::date,
        d.filing_date::date,
        coalesce(d.amount_range_label, 'NULL')
      having count(*) > 1
    )
    select disclosure_ids from duplicate_groups;
  `);

  const groups = duplicateGroups.rows as Array<{ disclosure_ids: number[] }>;
  let deletedDisclosures = 0;
  let deletedSignals = 0;
  let deletedPerformanceRows = 0;

  for (const group of groups) {
    const ids = group.disclosure_ids;
    if (!Array.isArray(ids) || ids.length <= 1) continue;

    const disclosureRows = await db
      .select({ id: disclosures.id, assetName: disclosures.assetName })
      .from(disclosures)
      .where(inArray(disclosures.id, ids));

    let keepId = disclosureRows[0]?.id ?? ids[0]!;
    let keepScore = scoreAssetNameQuality(disclosureRows[0]?.assetName ?? "");
    for (const row of disclosureRows.slice(1)) {
      const score = scoreAssetNameQuality(row.assetName);
      if (score > keepScore) {
        keepScore = score;
        keepId = row.id;
      }
    }

    const removeIds = ids.filter((id) => id !== keepId);

    const signalRows = await db
      .select({ id: researchSignals.id })
      .from(researchSignals)
      .where(inArray(researchSignals.disclosureId, removeIds));
    const signalIds = signalRows.map((row) => row.id);

    if (signalIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.researchSignalId, signalIds));
      await db.delete(researchSignals).where(inArray(researchSignals.id, signalIds));
      deletedSignals += signalIds.length;
    }

    if (removeIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.disclosureId, removeIds));
      await db
        .delete(disclosurePerformanceWindows)
        .where(inArray(disclosurePerformanceWindows.disclosureId, removeIds));
      await db.delete(disclosures).where(inArray(disclosures.id, removeIds));
      deletedDisclosures += removeIds.length;
      deletedPerformanceRows += removeIds.length;
    }
  }

  console.log(
    `🧹 Duplicate cleanup complete. deleted_disclosures=${deletedDisclosures}, deleted_signals=${deletedSignals}, deleted_performance_rows≈${deletedPerformanceRows}.`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const allSources = hasAllSourcesFlag(args);
  const shouldCleanupDuplicates = hasCleanupDuplicatesFlag(args);
  const now = new Date();
  const filingLagDaysExpr = sql<number>`(${disclosures.filingDate}::date - ${disclosures.tradeDate}::date)`;
  const scopeCondition = sourceScopeCondition(allSources);

  const disclosureSourceLabelRows = (await db
    .select({
      sourceLabel: disclosures.sourceLabel,
      count: sql<number>`count(*)`,
    })
    .from(disclosures)
    .where(scopeCondition)
    .groupBy(disclosures.sourceLabel)
    .orderBy(sql`count(*) desc`, disclosures.sourceLabel)) as SourceLabelCountRow[];

  const signalSourceLabelRows = (await db
    .select({
      sourceLabel: disclosures.sourceLabel,
      count: sql<number>`count(*)`,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(scopeCondition)
    .groupBy(disclosures.sourceLabel)
    .orderBy(sql`count(*) desc`, disclosures.sourceLabel)) as SourceLabelCountRow[];

  const unknownTickerRows = (await db
    .select({
      ticker: disclosures.ticker,
      count: sql<number>`count(*)`,
    })
    .from(disclosures)
    .where(
      and(
        scopeCondition,
        or(isNull(disclosures.ticker), sql`upper(${disclosures.ticker}) = 'UNKNOWN'`)
      )
    )
    .groupBy(disclosures.ticker)
    .orderBy(sql`count(*) desc`)) as UnknownTickerRow[];

  const invalidDateOrderResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(disclosures)
    .where(
      and(
        scopeCondition,
        sql`${disclosures.tradeDate} is not null`,
        sql`${disclosures.filingDate} is not null`,
        gt(disclosures.tradeDate, disclosures.filingDate)
      )
    );

  const futureTradeDateResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(disclosures)
    .where(
      and(
        scopeCondition,
        sql`${disclosures.tradeDate} is not null`,
        gt(disclosures.tradeDate, now)
      )
    );

  const filingLagHouseOnly = await getFilingLagRange(false);
  const filingLagAllSources = await getFilingLagRange(true);
  const filingLagCurrentScope = allSources ? filingLagAllSources : filingLagHouseOnly;

  const minLagRows = (await db
    .select({
      disclosureId: disclosures.id,
      ticker: disclosures.ticker,
      politician: politicians.fullName,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: filingLagDaysExpr,
    })
    .from(disclosures)
    .innerJoin(politicians, eq(disclosures.politicianId, politicians.id))
    .where(
      and(
        scopeCondition,
        sql`${disclosures.tradeDate} is not null`,
        sql`${disclosures.filingDate} is not null`
      )
    )
    .orderBy(filingLagDaysExpr, disclosures.id)
    .limit(3)) as FilingLagSampleRow[];

  const maxLagRows = (await db
    .select({
      disclosureId: disclosures.id,
      ticker: disclosures.ticker,
      politician: politicians.fullName,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: filingLagDaysExpr,
    })
    .from(disclosures)
    .innerJoin(politicians, eq(disclosures.politicianId, politicians.id))
    .where(
      and(
        scopeCondition,
        sql`${disclosures.tradeDate} is not null`,
        sql`${disclosures.filingDate} is not null`
      )
    )
    .orderBy(desc(filingLagDaysExpr), desc(disclosures.id))
    .limit(3)) as FilingLagSampleRow[];

  const invalidSignalCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(
      and(
        scopeCondition,
        or(
          isNull(disclosures.ticker),
          sql`upper(${disclosures.ticker}) = 'UNKNOWN'`,
          isNull(disclosures.tradeDate),
          isNull(disclosures.filingDate),
          gt(disclosures.tradeDate, disclosures.filingDate),
          gt(disclosures.tradeDate, now),
          sql`${disclosures.filingLagDays} < 0`
        )
      )
    );

  const duplicateGroupRows = await db.execute(sql`
    with duplicate_groups as (
      select
        d.politician_id as "politicianId",
        p.full_name as "politicianName",
        d.ticker as ticker,
        d.trade_type as "tradeType",
        d.trade_date as "tradeDate",
        d.filing_date as "filingDate",
        d.amount_range_label as "amountRangeLabel",
        count(*)::int as duplicate_count
      from disclosures d
      inner join politicians p on p.id = d.politician_id
      where ${allSources ? sql`true` : sql`d.source_label = ${HOUSE_SOURCE_LABEL}`}
      group by
        d.politician_id,
        p.full_name,
        d.ticker,
        d.trade_type,
        d.trade_date,
        d.filing_date,
        d.amount_range_label
      having count(*) > 1
    )
    select
      "politicianId",
      "politicianName",
      ticker,
      "tradeType",
      "tradeDate",
      "filingDate",
      "amountRangeLabel",
      duplicate_count as "duplicateCount"
    from duplicate_groups
    order by duplicate_count desc, "tradeDate" desc nulls last
    limit 100;
  `);

  type DuplicateGroupRow = {
    politicianId: number;
    politicianName: string;
    ticker: string | null;
    tradeType: string;
    tradeDate: Date | null;
    filingDate: Date | null;
    amountRangeLabel: string | null;
    duplicateCount: number;
  };

  const duplicateGroups = duplicateGroupRows.rows as DuplicateGroupRow[];

  const sampleRowsByGroup = new Map<string, Array<{
    id: number;
    assetName: string;
    ownerType: string;
    amountRangeLabel: string | null;
    sourceUrl: string | null;
  }>>();
  for (const group of duplicateGroups.slice(0, 10)) {
    const sampleRows = await db
      .select({
        id: disclosures.id,
        assetName: disclosures.assetName,
        ownerType: disclosures.ownerType,
        amountRangeLabel: disclosures.amountRangeLabel,
        sourceUrl: disclosures.sourceUrl,
      })
      .from(disclosures)
      .where(
        and(
          eq(disclosures.politicianId, group.politicianId),
          group.ticker ? eq(disclosures.ticker, group.ticker) : isNull(disclosures.ticker),
          eq(disclosures.tradeType, group.tradeType),
          group.tradeDate ? eq(disclosures.tradeDate, group.tradeDate) : isNull(disclosures.tradeDate),
          group.filingDate ? eq(disclosures.filingDate, group.filingDate) : isNull(disclosures.filingDate),
          group.amountRangeLabel
            ? eq(disclosures.amountRangeLabel, group.amountRangeLabel)
            : isNull(disclosures.amountRangeLabel)
        )
      )
      .orderBy(disclosures.id)
      .limit(5);
    const groupKey = `${group.politicianId}|${group.ticker ?? "null"}|${group.tradeType}|${group.tradeDate?.toISOString() ?? "null"}`;
    sampleRowsByGroup.set(groupKey, sampleRows);
  }

  const invalidDateOrderCount = parseNumeric(invalidDateOrderResult[0]?.count);
  const futureTradeDateCount = parseNumeric(futureTradeDateResult[0]?.count);
  const minLag = filingLagCurrentScope.minLag;
  const maxLag = filingLagCurrentScope.maxLag;
  const avgLag = filingLagCurrentScope.avgLag;
  const filingLagCount = filingLagCurrentScope.count;
  const invalidSignalCount = parseNumeric(invalidSignalCountResult[0]?.count);

  console.log("🧪 House import diagnostics");
  console.log(`   scope: ${allSources ? "all disclosures/signals (--all-sources)" : `house-only (${HOUSE_SOURCE_LABEL})`}`);
  console.log("   disclosure counts by sourceLabel:");
  if (disclosureSourceLabelRows.length === 0) {
    console.log("   - none");
  } else {
    for (const row of disclosureSourceLabelRows) {
      console.log(`   - sourceLabel=${row.sourceLabel}: ${parseNumeric(row.count)}`);
    }
  }
  console.log("   research signal counts by disclosure sourceLabel:");
  if (signalSourceLabelRows.length === 0) {
    console.log("   - none");
  } else {
    for (const row of signalSourceLabelRows) {
      console.log(`   - sourceLabel=${row.sourceLabel}: ${parseNumeric(row.count)}`);
    }
  }
  console.log("   UNKNOWN/null ticker disclosure counts:");

  if (unknownTickerRows.length === 0) {
    console.log("   - none");
  } else {
    for (const row of unknownTickerRows) {
      console.log(`   - ticker=${row.ticker ?? "NULL"}: ${parseNumeric(row.count)}`);
    }
  }

  console.log(`   trade_date > filing_date: ${invalidDateOrderCount}`);
  console.log(`   future trade_date: ${futureTradeDateCount}`);
  console.log(
    `   filing_lag_days House-only (${HOUSE_SOURCE_LABEL}): count=${filingLagHouseOnly.count}, min=${filingLagHouseOnly.minLag ?? "NULL"}, max=${filingLagHouseOnly.maxLag ?? "NULL"}, avg=${filingLagHouseOnly.avgLag ?? "NULL"}`
  );
  console.log(
    `   filing_lag_days all sources: count=${filingLagAllSources.count}, min=${filingLagAllSources.minLag ?? "NULL"}, max=${filingLagAllSources.maxLag ?? "NULL"}, avg=${filingLagAllSources.avgLag ?? "NULL"}`
  );
  console.log(
    `   filing_lag_days current scope (filing_date - trade_date): count=${filingLagCount}, min=${minLag ?? "NULL"}, max=${maxLag ?? "NULL"}, avg=${avgLag ?? "NULL"}`
  );
  console.log("   min lag sample rows:");
  if (minLagRows.length === 0) {
    console.log("   - none");
  } else {
    for (const row of minLagRows) {
      console.log(
        `   - disclosure_id=${row.disclosureId}, ticker=${row.ticker ?? "NULL"}, politician=${row.politician}, trade_date=${formatDate(row.tradeDate)}, filing_date=${formatDate(row.filingDate)}, filing_lag_days=${row.filingLagDays}`
      );
    }
  }
  console.log("   max lag sample rows:");
  if (maxLagRows.length === 0) {
    console.log("   - none");
  } else {
    for (const row of maxLagRows) {
      console.log(
        `   - disclosure_id=${row.disclosureId}, ticker=${row.ticker ?? "NULL"}, politician=${row.politician}, trade_date=${formatDate(row.tradeDate)}, filing_date=${formatDate(row.filingDate)}, filing_lag_days=${row.filingLagDays}`
      );
    }
  }
  console.log(`   research_signals tied to invalid disclosures: ${invalidSignalCount}`);
  console.log(`   likely duplicate House disclosure groups (>1 row): ${duplicateGroups.length}`);
  if (duplicateGroups.length === 0) {
    console.log("   - duplicate groups: none");
  } else {
    for (const group of duplicateGroups.slice(0, 20)) {
      console.log(
        `   - politician_id=${group.politicianId}, politician=${group.politicianName}, ticker=${group.ticker ?? "NULL"}, trade_type=${group.tradeType}, trade_date=${group.tradeDate ? formatDate(group.tradeDate) : "NULL"}, filing_date=${group.filingDate ? formatDate(group.filingDate) : "NULL"}, amount_range_label=${group.amountRangeLabel ?? "NULL"}, count=${group.duplicateCount}`
      );
      const groupKey = `${group.politicianId}|${group.ticker ?? "null"}|${group.tradeType}|${group.tradeDate?.toISOString() ?? "null"}`;
      const sampleRows = sampleRowsByGroup.get(groupKey) ?? [];
      for (const sample of sampleRows) {
        console.log(
          `      sample: disclosure_id=${sample.id}, asset_name=${sample.assetName}, owner_type=${sample.ownerType}, amount_range_label=${sample.amountRangeLabel ?? "NULL"}, source_url=${sample.sourceUrl ?? "NULL"}`
        );
      }
    }
  }

  if (shouldCleanupDuplicates) {
    console.log("   cleanup: --cleanup-duplicates requested; applying cleanup now (house scope only).");
    await cleanupHouseDuplicateDisclosures();
  }
}

main().catch((error) => {
  console.error("❌ Failed to run house import diagnostics:", error);
  process.exit(1);
});
