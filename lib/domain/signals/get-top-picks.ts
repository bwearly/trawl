import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";

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
      sourceUrl: disclosures.sourceUrl,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
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
