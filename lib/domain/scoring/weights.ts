export const SCORE_MAX = 100;

export const SCORE_WEIGHTS = {
  tradeType: 18,
  tradeSize: 16,
  filingFreshness: 5,
  historicalPolitician: 20,
  momentum: 22,
  committeeRelevance: 10,
  cluster: 5,
  userRelevance: 5,
} as const;

export type ScoreWeights = typeof SCORE_WEIGHTS;
