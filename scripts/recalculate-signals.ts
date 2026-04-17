import "dotenv/config";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  researchSignals,
} from "../lib/db/schema";
import { scoreSignal } from "../lib/domain/scoring/scoreSignals";
import { generateAlertsForSignal } from "../lib/domain/alerts/alerts";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseNumeric(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function calcAlpha(
  stockReturn: string | number | null | undefined,
  spyReturn: string | number | null | undefined
): number | null {
  const stock = parseNumeric(stockReturn);
  const spy = parseNumeric(spyReturn);

  if (stock == null || spy == null) return null;
  return round2(stock - spy);
}

function scoreHistoricalPoliticianFromAlphas(alphas: number[]): number {
  if (alphas.length === 0) {
    return 10;
  }

  const sampleSize = alphas.length;
  const winRate = alphas.filter((alpha) => alpha > 0).length / sampleSize;
  const avgAlpha =
    alphas.reduce((sum, alpha) => sum + alpha, 0) / sampleSize;

  // Build a raw score centered around neutral = 10
  const winRateAdjustment = (winRate - 0.5) * 12; // range roughly -6 to +6
  const alphaAdjustment = Math.max(-4, Math.min(avgAlpha, 4)); // range -4 to +4

  const rawScore = 10 + winRateAdjustment + alphaAdjustment;

  // Confidence ramps in slowly so tiny samples stay near neutral
  const confidence = Math.min(sampleSize / 5, 1);

  const blendedScore = 10 + (rawScore - 10) * confidence;

  return round2(Math.max(0, Math.min(blendedScore, 20)));
}

async function main() {
  console.log("Recalculating research signals...");

  const rows = await db
    .select({
      disclosure: disclosures,
      performance: disclosurePerformanceWindows,
    })
    .from(disclosures)
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    );

  console.log(`Found ${rows.length} disclosures.`);

  for (const row of rows) {
    const disclosure = row.disclosure;
    const performance = row.performance;

    const priorRows = await db
      .select({
        return7d: disclosurePerformanceWindows.return7d,
        spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
        return30d: disclosurePerformanceWindows.return30d,
        spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
      })
      .from(disclosures)
      .leftJoin(
        disclosurePerformanceWindows,
        eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
      )
      .where(
        and(
          eq(disclosures.politicianId, disclosure.politicianId),
          lt(disclosures.id, disclosure.id)
        )
      );

    const historicalAlphas = priorRows
      .map((prior) => {
        const alpha30d = calcAlpha(prior.return30d, prior.spyReturn30d);
        if (alpha30d != null) return alpha30d;

        const alpha7d = calcAlpha(prior.return7d, prior.spyReturn7d);
        return alpha7d;
      })
      .filter((alpha): alpha is number => alpha != null);

    const historicalPoliticianScore =
      scoreHistoricalPoliticianFromAlphas(historicalAlphas);

    const scored = scoreSignal({
      tradeType: disclosure.tradeType,
      amountMin: disclosure.amountMin,
      amountMax: disclosure.amountMax,
      filingLagDays: disclosure.filingLagDays,

      return7d: performance?.return7d ?? null,
      spyReturn7d: performance?.spyReturn7d ?? null,
      return30d: performance?.return30d ?? null,
      spyReturn30d: performance?.spyReturn30d ?? null,

      historicalPoliticianScore,
      committeeRelevanceScore: 5,
      clusterScore: 3,
      userRelevanceScore: 2,
    });

    const existing = await db
      .select()
      .from(researchSignals)
      .where(eq(researchSignals.disclosureId, disclosure.id));

    if (existing.length > 0) {
      const updatedRows = await db
        .update(researchSignals)
        .set({
          ticker: disclosure.ticker ?? "UNKNOWN",
          score: scored.totalScore.toFixed(2),
          signalStatus: "active",
          primaryReason: scored.primaryReason,
          reasonSummary: scored.reasonSummary,
          tradeTypeScore: scored.breakdown.tradeTypeScore.toFixed(2),
          tradeSizeScore: scored.breakdown.tradeSizeScore.toFixed(2),
          filingFreshnessScore: scored.breakdown.filingFreshnessScore.toFixed(2),
          historicalPoliticianScore:
            scored.breakdown.historicalPoliticianScore.toFixed(2),
          momentumScore: scored.breakdown.momentumScore.toFixed(2),
          committeeRelevanceScore:
            scored.breakdown.committeeRelevanceScore.toFixed(2),
          clusterScore: scored.breakdown.clusterScore.toFixed(2),
          userRelevanceScore: scored.breakdown.userRelevanceScore.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(researchSignals.disclosureId, disclosure.id))
        .returning({ id: researchSignals.id });

      const updatedSignal = updatedRows[0];

      if (updatedSignal) {
        await generateAlertsForSignal(updatedSignal.id);
      }

      console.log(
        `Updated signal for disclosure ${disclosure.id} (${disclosure.ticker ?? "UNKNOWN"})`
      );
    } else {
      const insertedRows = await db
        .insert(researchSignals)
        .values({
          disclosureId: disclosure.id,
          politicianId: disclosure.politicianId,
          ticker: disclosure.ticker ?? "UNKNOWN",
          score: scored.totalScore.toFixed(2),
          signalStatus: "active",
          primaryReason: scored.primaryReason,
          reasonSummary: scored.reasonSummary,
          tradeTypeScore: scored.breakdown.tradeTypeScore.toFixed(2),
          tradeSizeScore: scored.breakdown.tradeSizeScore.toFixed(2),
          filingFreshnessScore: scored.breakdown.filingFreshnessScore.toFixed(2),
          historicalPoliticianScore:
            scored.breakdown.historicalPoliticianScore.toFixed(2),
          momentumScore: scored.breakdown.momentumScore.toFixed(2),
          committeeRelevanceScore:
            scored.breakdown.committeeRelevanceScore.toFixed(2),
          clusterScore: scored.breakdown.clusterScore.toFixed(2),
          userRelevanceScore: scored.breakdown.userRelevanceScore.toFixed(2),
          signalDate: new Date(),
        })
        .returning({ id: researchSignals.id });

      const insertedSignal = insertedRows[0];

      if (insertedSignal) {
        await generateAlertsForSignal(insertedSignal.id);
      }

      console.log(
        `Created signal for disclosure ${disclosure.id} (${disclosure.ticker ?? "UNKNOWN"})`
      );
    }

    console.log({
      disclosureId: disclosure.id,
      ticker: disclosure.ticker,
      return7d: performance?.return7d ?? null,
      spyReturn7d: performance?.spyReturn7d ?? null,
      return30d: performance?.return30d ?? null,
      spyReturn30d: performance?.spyReturn30d ?? null,
      historicalSampleSize: historicalAlphas.length,
      historicalPoliticianScore,
      momentumScore: scored.breakdown.momentumScore,
      totalScore: scored.totalScore,
      primaryReason: scored.primaryReason,
    });
  }

  console.log("Finished recalculating research signals.");
}

main().catch((err) => {
  console.error("Recalculation failed:", err);
  process.exit(1);
});