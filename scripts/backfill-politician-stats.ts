import { db } from "../lib/db";
import {
  disclosures,
  disclosurePerformanceWindows,
  politicianStats,
  politicians,
} from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";

type PoliticianRow = {
  id: number;
  fullName: string;
};

type PerformanceRow = {
  tradeType: string;
  filingLagDays: number | null;
  tradeDate: Date | null;
  return7d: string | null;
  return30d: string | null;
  return90d: string | null;
  spyReturn7d: string | null;
  spyReturn30d: string | null;
  spyReturn90d: string | null;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function winRate(values: number[]): number | null {
  if (!values.length) return null;
  const wins = values.filter((v) => v > 0).length;
  return (wins / values.length) * 100;
}

function round(value: number | null, decimals = 2): string | null {
  if (value === null) return null;
  return value.toFixed(decimals);
}

async function backfillPoliticianStats() {
  console.log("Recalculating politician stats...");

  const allPoliticians: PoliticianRow[] = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
    })
    .from(politicians);

  console.log(`Found ${allPoliticians.length} politicians.`);

  for (const politician of allPoliticians) {
    const rows: PerformanceRow[] = await db
      .select({
        tradeType: disclosures.tradeType,
        filingLagDays: disclosures.filingLagDays,
        tradeDate: disclosures.tradeDate,
        return7d: disclosurePerformanceWindows.return7d,
        return30d: disclosurePerformanceWindows.return30d,
        return90d: disclosurePerformanceWindows.return90d,
        spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
        spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
        spyReturn90d: disclosurePerformanceWindows.spyReturn90d,
      })
      .from(disclosures)
      .leftJoin(
        disclosurePerformanceWindows,
        eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
      )
      .where(eq(disclosures.politicianId, politician.id));

    const totalDisclosures = rows.length;
    const purchaseCount = rows.filter((r) => r.tradeType === "purchase").length;
    const saleCount = rows.filter((r) => r.tradeType === "sale").length;

    const filingLagValues = rows
      .map((r) => r.filingLagDays)
      .filter((v): v is number => v !== null);

    const return7dValues: number[] = [];
    const return30dValues: number[] = [];
    const return90dValues: number[] = [];

    const alpha7dValues: number[] = [];
    const alpha30dValues: number[] = [];
    const alpha90dValues: number[] = [];

    let lastTradeDate: Date | null = null;

    for (const row of rows) {
      if (row.tradeDate && (!lastTradeDate || row.tradeDate > lastTradeDate)) {
        lastTradeDate = row.tradeDate;
      }

      const r7 = toNumber(row.return7d);
      const r30 = toNumber(row.return30d);
      const r90 = toNumber(row.return90d);

      const spy7 = toNumber(row.spyReturn7d);
      const spy30 = toNumber(row.spyReturn30d);
      const spy90 = toNumber(row.spyReturn90d);

      if (r7 !== null) return7dValues.push(r7);
      if (r30 !== null) return30dValues.push(r30);
      if (r90 !== null) return90dValues.push(r90);

      if (r7 !== null && spy7 !== null) alpha7dValues.push(r7 - spy7);
      if (r30 !== null && spy30 !== null) alpha30dValues.push(r30 - spy30);
      if (r90 !== null && spy90 !== null) alpha90dValues.push(r90 - spy90);
    }

    const statsPayload = {
      politicianId: politician.id,
      totalDisclosures,
      purchaseCount,
      saleCount,
      avgReturn7d: round(average(return7dValues)),
      avgReturn30d: round(average(return30dValues)),
      avgReturn90d: round(average(return90dValues)),
      avgAlpha7d: round(average(alpha7dValues)),
      avgAlpha30d: round(average(alpha30dValues)),
      avgAlpha90d: round(average(alpha90dValues)),
      winRate7d: round(winRate(alpha7dValues)),
      winRate30d: round(winRate(alpha30dValues)),
      winRate90d: round(winRate(alpha90dValues)),
      avgFilingLagDays: round(average(filingLagValues)),
      lastTradeDate,
      updatedAt: new Date(),
    };

    await db
      .insert(politicianStats)
      .values(statsPayload)
      .onConflictDoUpdate({
        target: politicianStats.politicianId,
        set: {
          totalDisclosures: statsPayload.totalDisclosures,
          purchaseCount: statsPayload.purchaseCount,
          saleCount: statsPayload.saleCount,
          avgReturn7d: statsPayload.avgReturn7d,
          avgReturn30d: statsPayload.avgReturn30d,
          avgReturn90d: statsPayload.avgReturn90d,
          avgAlpha7d: statsPayload.avgAlpha7d,
          avgAlpha30d: statsPayload.avgAlpha30d,
          avgAlpha90d: statsPayload.avgAlpha90d,
          winRate7d: statsPayload.winRate7d,
          winRate30d: statsPayload.winRate30d,
          winRate90d: statsPayload.winRate90d,
          avgFilingLagDays: statsPayload.avgFilingLagDays,
          lastTradeDate: statsPayload.lastTradeDate,
          updatedAt: new Date(),
        },
      });

    console.log(`Updated stats for ${politician.fullName}`);
  }

  console.log("Done recalculating politician stats.");
}

backfillPoliticianStats().catch((error) => {
  console.error("Failed to backfill politician stats:", error);
  process.exit(1);
});