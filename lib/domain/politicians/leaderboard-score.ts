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
  const sampleReliability = clamp((input.validPerformanceCount / (input.validPerformanceCount + 24)) * 100);
  const disclosureDepth = clamp((input.totalDisclosures / (input.totalDisclosures + 12)) * 100);
  const filingTimeliness = input.avgFilingLagDays == null ? 45 : (() => {
    const lag = input.avgFilingLagDays;
    const base = clamp(100 - (lag / 180) * 100);
    let severeLagPenalty = 0;
    if (lag > 365) severeLagPenalty = 35;
    else if (lag > 180) severeLagPenalty = 20;
    else if (lag > 90) severeLagPenalty = 10;
    return clamp(base - severeLagPenalty);
  })();

  return Number((alphaScore * 0.32 + winRateScore * 0.24 + sampleReliability * 0.28 + disclosureDepth * 0.1 + filingTimeliness * 0.06).toFixed(2));
}
