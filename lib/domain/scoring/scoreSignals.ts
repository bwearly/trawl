import { SCORE_MAX, SCORE_WEIGHTS } from "./weights";

export type ScoreSignalInput = {
  tradeType: string;
  amountMin: number | null;
  amountMax: number | null;
  filingLagDays: number | null;

  // Optional benchmark-relative performance inputs
  return7d?: number | string | null;
  spyReturn7d?: number | string | null;
  return30d?: number | string | null;
  spyReturn30d?: number | string | null;

  // Optional direct component overrides
  historicalPoliticianScore?: number | null; // 0-20
  momentumScore?: number | null; // 0-22
  committeeRelevanceScore?: number | null; // 0-10
  clusterScore?: number | null; // 0-5
  userRelevanceScore?: number | null; // 0-5
};

export type ScoreSignalResult = {
  totalScore: number;
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
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseNumeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function calcAlpha(
  stockReturn: number | string | null | undefined,
  benchmarkReturn: number | string | null | undefined
): number | null {
  const stock = parseNumeric(stockReturn);
  const benchmark = parseNumeric(benchmarkReturn);

  if (stock == null || benchmark == null) return null;
  return round2(stock - benchmark);
}

function scoreTradeType(tradeType: string): number {
  switch (tradeType.toLowerCase()) {
    case "purchase":
      return SCORE_WEIGHTS.tradeType;
    case "exchange":
      return 10;
    case "sale":
      return 4;
    default:
      return 0;
  }
}

function scoreTradeSize(amountMin: number | null, amountMax: number | null): number {
  const value = amountMax ?? amountMin ?? 0;

  if (value >= 250000) return SCORE_WEIGHTS.tradeSize;
  if (value >= 100000) return 13;
  if (value >= 50000) return 10;
  if (value >= 15000) return 6;
  if (value >= 1000) return 3;

  return 0;
}

function scoreFilingFreshness(filingLagDays: number | null): number {
  if (filingLagDays == null) return 0;

  if (filingLagDays <= 7) return SCORE_WEIGHTS.filingFreshness;
  if (filingLagDays <= 14) return 6;
  if (filingLagDays <= 30) return 4;
  if (filingLagDays <= 45) return 2;

  return 1;
}

function scoreMomentumFromAlpha(
  return7d: number | string | null | undefined,
  spyReturn7d: number | string | null | undefined,
  return30d: number | string | null | undefined,
  spyReturn30d: number | string | null | undefined
): number {
  const alpha7d = calcAlpha(return7d, spyReturn7d);
  const alpha30d = calcAlpha(return30d, spyReturn30d);

  const has7d = alpha7d != null;
  const has30d = alpha30d != null;

  if (!has7d && !has30d) {
    return 8;
  }

  const resolved7d = alpha7d ?? 0;
  const resolved30d = alpha30d ?? 0;

  // Keep short-term bias, but reward confirmed 30d strength more than before.
  const blendedAlpha = resolved7d * 0.6 + resolved30d * 0.4;

  let rawScore = 8 + blendedAlpha * 2.2;

  // Strong negative relative performance should get punished harder.
  if (blendedAlpha <= -2) rawScore -= 3;
  if (blendedAlpha <= -5) rawScore -= 3;

  // Strong positive relative performance should have a path to top-end scores.
  if (blendedAlpha >= 5) rawScore += 2;
  if (blendedAlpha >= 10) rawScore += 2;

  return round2(clamp(rawScore, 0, SCORE_WEIGHTS.momentum));
}

function getPrimaryReason(
  result: ScoreSignalResult["breakdown"],
  input: ScoreSignalInput
): string {
  const alpha7d = calcAlpha(input.return7d, input.spyReturn7d);
  const alpha30d = calcAlpha(input.return30d, input.spyReturn30d);
  const bestAlpha = Math.max(
    alpha7d ?? Number.NEGATIVE_INFINITY,
    alpha30d ?? Number.NEGATIVE_INFINITY
  );

  const entries = [
    {
      key: "tradeTypeScore",
      label: "Strong purchase signal",
      value: result.tradeTypeScore,
    },
    {
      key: "tradeSizeScore",
      label: "Large reported trade",
      value: result.tradeSizeScore,
    },
    {
      key: "filingFreshnessScore",
      label: "Fresh disclosure timing",
      value: result.filingFreshnessScore,
    },
    {
      key: "historicalPoliticianScore",
      label: "Historically strong politician profile",
      value: result.historicalPoliticianScore,
    },
    {
      key: "momentumScore",
      label:
        bestAlpha > 0
          ? "Outperformance versus SPY"
          : "Positive momentum context",
      value: result.momentumScore,
    },
    {
      key: "committeeRelevanceScore",
      label: "Strong committee relevance",
      value: result.committeeRelevanceScore,
    },
    {
      key: "clusterScore",
      label: "Clustered activity",
      value: result.clusterScore,
    },
    {
      key: "userRelevanceScore",
      label: "High user relevance",
      value: result.userRelevanceScore,
    },
  ];

  entries.sort((a, b) => b.value - a.value);
  return entries[0]?.label ?? "Not enough signal data";
}

function getReasonSummary(
  breakdown: ScoreSignalResult["breakdown"],
  input: ScoreSignalInput
): string {
  const reasons: string[] = [];
  const alpha7d = calcAlpha(input.return7d, input.spyReturn7d);
  const alpha30d = calcAlpha(input.return30d, input.spyReturn30d);

  if (
    breakdown.tradeTypeScore >= 15 &&
    input.tradeType.toLowerCase() === "purchase"
  ) {
    reasons.push("purchase disclosure");
  }

  if (breakdown.tradeSizeScore >= 12) {
    reasons.push("large reported trade size");
  }

  if (breakdown.filingFreshnessScore >= 6) {
    reasons.push("fresh filing timing");
  }

  if (breakdown.historicalPoliticianScore >= 14) {
    reasons.push("strong historical politician profile");
  }

  if (alpha7d != null && alpha7d >= 2) {
    reasons.push("strong 7-day outperformance vs SPY");
  } else if (alpha30d != null && alpha30d >= 2) {
    reasons.push("strong 30-day outperformance vs SPY");
  } else if (breakdown.momentumScore >= 14) {
    reasons.push("positive momentum context");
  }

  if (breakdown.committeeRelevanceScore >= 7) {
    reasons.push("committee and sector overlap");
  }

  if (breakdown.clusterScore >= 4) {
    reasons.push("clustered activity in related names");
  }

  if (breakdown.userRelevanceScore >= 4) {
    reasons.push("match with user preferences");
  }

  if (reasons.length === 0) {
    return "This signal scored based on a mix of disclosure characteristics, though no single factor strongly dominated.";
  }

  return `This signal scored well due to ${reasons.join(", ")}.`;
}

export function scoreSignal(input: ScoreSignalInput): ScoreSignalResult {
  const resolvedMomentumScore =
    input.momentumScore != null
      ? clamp(input.momentumScore, 0, SCORE_WEIGHTS.momentum)
      : scoreMomentumFromAlpha(
          input.return7d,
          input.spyReturn7d,
          input.return30d,
          input.spyReturn30d
        );

  const breakdown = {
    tradeTypeScore: scoreTradeType(input.tradeType),
    tradeSizeScore: scoreTradeSize(input.amountMin, input.amountMax),
    filingFreshnessScore: scoreFilingFreshness(input.filingLagDays),
    historicalPoliticianScore: clamp(
      input.historicalPoliticianScore ?? 0,
      0,
      SCORE_WEIGHTS.historicalPolitician
    ),
    momentumScore: resolvedMomentumScore,
    committeeRelevanceScore: clamp(
      input.committeeRelevanceScore ?? 0,
      0,
      SCORE_WEIGHTS.committeeRelevance
    ),
    clusterScore: clamp(input.clusterScore ?? 0, 0, SCORE_WEIGHTS.cluster),
    userRelevanceScore: clamp(
      input.userRelevanceScore ?? 0,
      0,
      SCORE_WEIGHTS.userRelevance
    ),
  };

  const rawTotal =
    breakdown.tradeTypeScore +
    breakdown.tradeSizeScore +
    breakdown.filingFreshnessScore +
    breakdown.historicalPoliticianScore +
    breakdown.momentumScore +
    breakdown.committeeRelevanceScore +
    breakdown.clusterScore +
    breakdown.userRelevanceScore;

  const totalScore = round2(clamp(rawTotal, 0, SCORE_MAX));
  const primaryReason = getPrimaryReason(breakdown, input);
  const reasonSummary = getReasonSummary(breakdown, input);

  return {
    totalScore,
    primaryReason,
    reasonSummary,
    breakdown,
  };
}
