export const MAX_DIGEST_FILING_LAG_DAYS = 45;

export function isDigestSignalActionable(input: { tradeType: string; filingLagDays: number | null; score: number; minScore: number }) {
  if (input.tradeType !== "purchase") return { ok: false, reason: "trade_type" as const };
  if (input.filingLagDays != null && input.filingLagDays > MAX_DIGEST_FILING_LAG_DAYS) return { ok: false, reason: "filing_lag" as const };
  if (input.score < input.minScore) return { ok: false, reason: "score" as const };
  return { ok: true, reason: null };
}
