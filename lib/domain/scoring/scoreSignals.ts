import { getFilingLagPenalty } from "@/lib/domain/signals/filing-freshness";
import { SCORE_MAX, SCORE_WEIGHTS } from "@/lib/domain/scoring/weights";

export type SignalStage = "fresh" | "developing" | "mature" | "historical";

export type ScoreSignalInput = {
  tradeType: string;
  amountMin: number | null;
  amountMax: number | null;
  filingLagDays: number | null;
  daysSinceFiling?: number | null;

  return7d?: number | string | null;
  spyReturn7d?: number | string | null;
  return30d?: number | string | null;
  spyReturn30d?: number | string | null;
  return90d?: number | string | null;
  spyReturn90d?: number | string | null;

  historicalPoliticianScore?: number | null; // 0-100
  committeeRelevanceScore?: number | null; // 0-100
  clusterScore?: number | null; // 0-100
  userRelevanceScore?: number | null; // 0-100
  dataConfidenceScore?: number | null; // 0-100
  historicalSampleSize?: number | null;
};

export type ScoreSignalResult = {
  totalScore: number;
  signalScore: number;
  performanceScore: number | null;
  signalStage: SignalStage;
  primaryReason: string;
  reasonSummary: string;
  breakdown: {
    tradeTypeScore: number;
    tradeSizeScore: number;
    filingFreshnessScore: number;
    historicalPoliticianScore: number;
    momentumScore: number;
    committeeRelevanceScore: number;
    clusterScore: number;
    userRelevanceScore: number;
    dataConfidenceScore: number;
    alpha7dScore: number | null;
    alpha30dScore: number | null;
    alpha90dScore: number | null;
    winLossScore: number | null;
  };
};

const round2 = (v: number) => Math.round(v * 100) / 100;
export const clamp = (v: number, min = 0, max = SCORE_MAX) => Math.max(min, Math.min(max, v));
export const normalizeScore = (v: number, min: number, max: number) => clamp(((v - min) / (max - min)) * 100, 0, 100);

function parseNumeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function calcAlpha(stockReturn: number | string | null | undefined, benchmarkReturn: number | string | null | undefined): number | null {
  const stock = parseNumeric(stockReturn);
  const benchmark = parseNumeric(benchmarkReturn);
  if (stock == null || benchmark == null) return null;
  return round2(stock - benchmark);
}

export function alphaToScore(alpha: number | null): number | null {
  if (alpha == null) return null;
  return round2(normalizeScore(alpha, -15, 15));
}

export function sampleSizeConfidenceAdjustment(rawScore: number, sampleSize: number | null | undefined): number {
  const n = Math.max(0, sampleSize ?? 0);
  const confidence = n / (n + 12);
  return round2(50 + (rawScore - 50) * confidence);
}

export function classifySignalStage(daysSinceFiling: number | null | undefined, filingLagDays: number | null | undefined): SignalStage {
  const age = daysSinceFiling ?? null;
  if ((filingLagDays ?? 0) > 365) return "historical";
  if (age == null || age <= 7) return "fresh";
  if (age <= 30) return "developing";
  return "mature";
}

export function scoreFreshnessAndLag(filingLagDays: number | null): number {
  if (filingLagDays == null) return 45;
  if (filingLagDays <= 7) return 95;
  if (filingLagDays <= 15) return 85;
  if (filingLagDays <= 45) return 65;
  if (filingLagDays <= 90) return 45;
  if (filingLagDays <= 180) return 30;
  if (filingLagDays <= 365) return 15;
  return 5;
}

function scoreTradeType(tradeType: string): number {
  const t = tradeType.toLowerCase();
  if (t === "purchase") return 90;
  if (t === "exchange") return 60;
  if (t === "sale") return 35;
  return 45;
}

function scoreTradeSize(amountMin: number | null, amountMax: number | null): number {
  const value = amountMax ?? amountMin ?? 0;
  if (value >= 1_000_000) return 95;
  if (value >= 250_000) return 85;
  if (value >= 100_000) return 70;
  if (value >= 50_000) return 60;
  if (value >= 15_000) return 50;
  if (value >= 1_000) return 40;
  return 30;
}

export function scoreSignal(input: ScoreSignalInput): ScoreSignalResult {
  const alpha7d = calcAlpha(input.return7d, input.spyReturn7d);
  const alpha30d = calcAlpha(input.return30d, input.spyReturn30d);
  const alpha90d = calcAlpha(input.return90d, input.spyReturn90d);

  const signalStage = classifySignalStage(input.daysSinceFiling, input.filingLagDays);

  const politicianEdgeRaw = clamp(input.historicalPoliticianScore ?? 50);
  const politicianEdge = sampleSizeConfidenceAdjustment(politicianEdgeRaw, input.historicalSampleSize);
  const tradeStrength = round2((scoreTradeType(input.tradeType) * 0.55) + (scoreTradeSize(input.amountMin, input.amountMax) * 0.45));
  const freshness = scoreFreshnessAndLag(input.filingLagDays);
  const has7d = alpha7d != null;
  const has30d = alpha30d != null;
  const has90d = alpha90d != null;
  const hasAnyPerformance = has7d || has30d || has90d;
  const missingPerformancePenalty = hasAnyPerformance ? 0 : 8;
  const baseDataConfidence = clamp(input.dataConfidenceScore ?? 70);
  const dataConfidence = clamp(baseDataConfidence - missingPerformancePenalty);

  const alpha7dScore = alphaToScore(alpha7d);
  const alpha30dScore = alphaToScore(alpha30d);
  const alpha90dScore = alphaToScore(alpha90d);

  const baseWeighted =
    (scoreTradeType(input.tradeType) / 100) * SCORE_WEIGHTS.tradeType +
    (scoreTradeSize(input.amountMin, input.amountMax) / 100) * SCORE_WEIGHTS.tradeSize +
    (freshness / 100) * SCORE_WEIGHTS.filingFreshness +
    (politicianEdge / 100) * SCORE_WEIGHTS.historicalPolitician +
    (clamp(input.committeeRelevanceScore ?? 50) / 100) * SCORE_WEIGHTS.committeeRelevance +
    (clamp(input.clusterScore ?? 50) / 100) * SCORE_WEIGHTS.cluster +
    (clamp(input.userRelevanceScore ?? 50) / 100) * SCORE_WEIGHTS.userRelevance +
    (dataConfidence / 100) * 4;

  const momentumComponent = ((alpha7dScore ?? 40) / 100) * SCORE_WEIGHTS.momentum;
  const signalScore = round2(clamp(baseWeighted + momentumComponent - missingPerformancePenalty, 0, SCORE_MAX));
  const wins = [alpha7d, alpha30d, alpha90d].filter((a): a is number => a != null).filter((a) => a > 0).length;
  const samples = [alpha7d, alpha30d, alpha90d].filter((a): a is number => a != null).length;
  const winLossScore = samples === 0 ? null : round2((wins / samples) * 100);

  let weighted = 0;
  let totalWeight = 0;
  if (signalStage === "developing" || signalStage === "mature" || signalStage === "historical") {
    if (alpha7dScore != null) { weighted += alpha7dScore * 0.25; totalWeight += 0.25; }
  }
  if (signalStage === "mature" || signalStage === "historical") {
    if (alpha30dScore != null) { weighted += alpha30dScore * 0.4; totalWeight += 0.4; }
    if (alpha90dScore != null) { weighted += alpha90dScore * 0.25; totalWeight += 0.25; }
  }
  if (winLossScore != null) { weighted += winLossScore * 0.1; totalWeight += 0.1; }
  const performanceScore = totalWeight > 0 ? round2(weighted / totalWeight) : null;

  const filingLagPenalty = getFilingLagPenalty(input.filingLagDays);
  const totalScore = round2(clamp(signalScore - filingLagPenalty, 0, SCORE_MAX));

  return {
    totalScore,
    signalScore: totalScore,
    performanceScore,
    signalStage,
    primaryReason: !hasAnyPerformance
      ? "Limited confidence due to missing performance history"
      : politicianEdge >= tradeStrength
        ? "Historically strong politician edge"
        : signalScore >= 70
          ? "Strong trade context and timing"
          : "Moderate trade context and timing",
    reasonSummary: `Signal score prioritizes politician edge, filing timeliness, trade strength, and context. Stage: ${signalStage}${freshness <= 30 ? "; low actionability due to stale filing lag" : ""}${!hasAnyPerformance ? "; conservative confidence because 7d/30d/90d performance windows are not yet available" : ""}.`,
    breakdown: {
      tradeTypeScore: round2((scoreTradeType(input.tradeType) / 100) * SCORE_WEIGHTS.tradeType),
      tradeSizeScore: round2((scoreTradeSize(input.amountMin, input.amountMax) / 100) * SCORE_WEIGHTS.tradeSize),
      filingFreshnessScore: round2((freshness / 100) * SCORE_WEIGHTS.filingFreshness),
      historicalPoliticianScore: round2((politicianEdge / 100) * SCORE_WEIGHTS.historicalPolitician),
      momentumScore: round2(((alpha7dScore ?? 40) / 100) * SCORE_WEIGHTS.momentum),
      committeeRelevanceScore: round2((clamp(input.committeeRelevanceScore ?? 50) / 100) * SCORE_WEIGHTS.committeeRelevance),
      clusterScore: round2((clamp(input.clusterScore ?? 50) / 100) * SCORE_WEIGHTS.cluster),
      userRelevanceScore: round2((clamp(input.userRelevanceScore ?? 50) / 100) * SCORE_WEIGHTS.userRelevance),
      dataConfidenceScore: dataConfidence,
      alpha7dScore,
      alpha30dScore,
      alpha90dScore,
      winLossScore,
    },
  };
}
