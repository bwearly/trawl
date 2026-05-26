function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export function computeLeaderboardScore(input: {
  avgAlpha30d: number | null;
  winRate30d: number | null;
  totalDisclosures: number;
  validPerformanceCount: number;
  avgFilingLagDays: number | null;
}): number {
  const alphaScore = input.avgAlpha30d == null ? 45 : clamp(((input.avgAlpha30d + 10) / 20) * 100);
  const winRateScore = input.winRate30d == null ? 45 : clamp(input.winRate30d);
  const sampleReliability = clamp((input.validPerformanceCount / (input.validPerformanceCount + 8)) * 100);
  const disclosureDepth = clamp((input.totalDisclosures / (input.totalDisclosures + 12)) * 100);
  const filingTimeliness = input.avgFilingLagDays == null ? 45 : clamp(100 - (input.avgFilingLagDays / 180) * 100);

  return Number((alphaScore * 0.32 + winRateScore * 0.28 + sampleReliability * 0.22 + disclosureDepth * 0.12 + filingTimeliness * 0.06).toFixed(2));
}
