import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicianStats,
  politicians,
  researchSignals,
} from "@/lib/db/schema";

export async function getRecentlyFiled(limit = 6) {
  return db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
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
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      historicalSampleSize: politicianStats.totalDisclosures,
      sourceUrl: disclosures.sourceUrl,
      signalDate: researchSignals.signalDate,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .where(eq(researchSignals.signalStatus, "active"))
    .orderBy(
      desc(disclosures.filingDate),
      desc(researchSignals.signalDate),
      desc(researchSignals.score)
    )
    .limit(limit);
}
