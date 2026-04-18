import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicianStats,
  politicians,
  researchSignals,
} from "@/lib/db/schema";

export async function getTopPicks(limit = 6) {
  return db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      politicianName: politicians.fullName,
      politicanId: politicians.id,
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
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .where(
      and(
        eq(researchSignals.signalStatus, "active"),
        gte(researchSignals.score, "65"),
        eq(disclosures.tradeType, "purchase")
      )
    )
    .orderBy(
      desc(researchSignals.score),
      desc(disclosures.filingDate),
      desc(researchSignals.signalDate)
    )
    .limit(limit);
}
