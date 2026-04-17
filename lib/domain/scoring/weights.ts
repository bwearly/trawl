export const SCORE_MAX = 100;

export const SCORE_WEIGHTS = {
  tradeType: 20,
  tradeSize: 15,
  filingFreshness: 15,
  historicalPolitician: 20,
  momentum: 10,
  committeeRelevance: 10,
  cluster: 5,
  userRelevance: 5,
} as const;

export type ScoreWeights = typeof SCORE_WEIGHTS;