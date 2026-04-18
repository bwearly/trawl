export const SCORE_MAX = 100;

export const SCORE_WEIGHTS = {
  tradeType: 18,
  tradeSize: 18,
  filingFreshness: 12,
  historicalPolitician: 20,
  momentum: 15,
  committeeRelevance: 10,
  cluster: 5,
  userRelevance: 5,
} as const;

export type ScoreWeights = typeof SCORE_WEIGHTS;