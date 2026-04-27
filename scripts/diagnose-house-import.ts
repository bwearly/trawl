import { config } from "dotenv";
config({ path: ".env.local" });

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { disclosures, politicians, researchSignals } from "../lib/db/schema";

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

function parseNumeric(value: unknown): number {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function main() {
  const now = new Date();
  const filingLagDaysExpr = sql<number>`(${disclosures.filingDate}::date - ${disclosures.tradeDate}::date)`;

  const unknownTickerRows = (await db
    .select({
      ticker: disclosures.ticker,
      count: sql<number>`count(*)`,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
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
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
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
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
        sql`${disclosures.tradeDate} is not null`,
        gt(disclosures.tradeDate, now)
      )
    );

  const filingLagRangeResult = await db
    .select({
      minLag: sql<number | null>`min(${filingLagDaysExpr})`,
      maxLag: sql<number | null>`max(${filingLagDaysExpr})`,
      avgLag: sql<number | null>`avg(${filingLagDaysExpr})`,
      count: sql<number>`count(*)`,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
        sql`${disclosures.tradeDate} is not null`,
        sql`${disclosures.filingDate} is not null`
      )
    );

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
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
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
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
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
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
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

  const invalidDateOrderCount = parseNumeric(invalidDateOrderResult[0]?.count);
  const futureTradeDateCount = parseNumeric(futureTradeDateResult[0]?.count);
  const minLag = filingLagRangeResult[0]?.minLag ?? null;
  const maxLag = filingLagRangeResult[0]?.maxLag ?? null;
  const avgLag = filingLagRangeResult[0]?.avgLag ?? null;
  const filingLagCount = parseNumeric(filingLagRangeResult[0]?.count);
  const invalidSignalCount = parseNumeric(invalidSignalCountResult[0]?.count);

  console.log("🧪 House import diagnostics");
  console.log(`   source_label: ${HOUSE_SOURCE_LABEL}`);
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
    `   filing_lag_days (filing_date - trade_date): count=${filingLagCount}, min=${minLag ?? "NULL"}, max=${maxLag ?? "NULL"}, avg=${avgLag ?? "NULL"}`
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
}

main().catch((error) => {
  console.error("❌ Failed to run house import diagnostics:", error);
  process.exit(1);
});
