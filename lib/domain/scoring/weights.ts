export const SCORE_MAX = 100;

export const SCORE_WEIGHTS = {
  tradeType: 16,
  tradeSize: 14,
  filingFreshness: 18,
  historicalPolitician: 24,
  momentum: 10,
  committeeRelevance: 8,
  cluster: 5,
  userRelevance: 5,
} as const;

export type ScoreWeights = typeof SCORE_WEIGHTS;
