export const ALERT_ELIGIBILITY_THRESHOLDS = {
  minAdjustedScore: 65,
  highConvictionScore: 75,
  maxConfidencePenalty: 4,
  maxFilingLagDays: 90,
} as const;

export type AlertTier = "normal" | "high_conviction";

export type AlertEligibilityInput = {
  signalStatus: string;
  tradeType: string;
  adjustedScore: number;
  confidencePenalty: number | null;
  filingLagDays?: number | null;
};

export type AlertEligibilityResult = {
  shouldAlert: boolean;
  tier: AlertTier | null;
  blockedBy: string | null;
};

export function shouldGenerateAlert(
  input: AlertEligibilityInput
): AlertEligibilityResult {
  if (input.signalStatus !== "active") {
    return { shouldAlert: false, tier: null, blockedBy: "signal_status" };
  }

  if (input.tradeType !== "purchase") {
    return { shouldAlert: false, tier: null, blockedBy: "trade_type" };
  }

  if (input.adjustedScore < ALERT_ELIGIBILITY_THRESHOLDS.minAdjustedScore) {
    return { shouldAlert: false, tier: null, blockedBy: "adjusted_score" };
  }

  if (
    input.confidencePenalty != null &&
    input.confidencePenalty > ALERT_ELIGIBILITY_THRESHOLDS.maxConfidencePenalty
  ) {
    return { shouldAlert: false, tier: null, blockedBy: "confidence_penalty" };
  }

  if (
    input.filingLagDays != null &&
    input.filingLagDays > ALERT_ELIGIBILITY_THRESHOLDS.maxFilingLagDays
  ) {
    return { shouldAlert: false, tier: null, blockedBy: "filing_lag" };
  }

  return {
    shouldAlert: true,
    tier:
      input.adjustedScore >= ALERT_ELIGIBILITY_THRESHOLDS.highConvictionScore
        ? "high_conviction"
        : "normal",
    blockedBy: null,
  };
}
