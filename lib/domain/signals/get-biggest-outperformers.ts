import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicians,
  researchSignals,
} from "@/lib/db/schema";

const chosenAlpha = sql<number>`
  case
    when ${disclosurePerformanceWindows.return30d} is not null
      and ${disclosurePerformanceWindows.spyReturn30d} is not null
      then (${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d})::double precision
    when ${disclosurePerformanceWindows.return7d} is not null
      and ${disclosurePerformanceWindows.spyReturn7d} is not null
      then (${disclosurePerformanceWindows.return7d} - ${disclosurePerformanceWindows.spyReturn7d})::double precision
    else null
  end
`;

const alphaWindow = sql<"30d" | "7d">`
  case
    when ${disclosurePerformanceWindows.return30d} is not null
      and ${disclosurePerformanceWindows.spyReturn30d} is not null
      then '30d'
    else '7d'
  end
`;

export async function getBiggestOutperformers(limit = 6) {
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
      sourceUrl: disclosures.sourceUrl,
      signalDate: researchSignals.signalDate,
      alpha7d: sql<number | null>`(
        ${disclosurePerformanceWindows.return7d} - ${disclosurePerformanceWindows.spyReturn7d}
      )::double precision`,
      alpha30d: sql<number | null>`(
        ${disclosurePerformanceWindows.return30d} - ${disclosurePerformanceWindows.spyReturn30d}
      )::double precision`,
      chosenAlpha: chosenAlpha.as("chosen_alpha"),
      chosenAlphaWindow: alphaWindow.as("chosen_alpha_window"),
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .where(
      and(
        eq(researchSignals.signalStatus, "active"),
        or(
          and(
            isNotNull(disclosurePerformanceWindows.return30d),
            isNotNull(disclosurePerformanceWindows.spyReturn30d)
          ),
          and(
            isNotNull(disclosurePerformanceWindows.return7d),
            isNotNull(disclosurePerformanceWindows.spyReturn7d)
          )
        )
      )
    )
    .orderBy(
      desc(chosenAlpha),
      desc(researchSignals.score),
      desc(disclosures.filingDate),
      desc(researchSignals.signalDate)
    )
    .limit(limit);
}
