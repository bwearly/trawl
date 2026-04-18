export type SignalConfidenceTier = "high" | "medium" | "low";

export type SignalConfidenceTierResult = {
  tier: SignalConfidenceTier;
  label: "High confidence" | "Medium confidence" | "Low confidence";
  confidencePenalty: number;
  isDerived: boolean;
};

type SignalConfidenceTierInput = {
  confidencePenalty?: number | null;
  hasReturn7d?: boolean;
  hasReturn30d?: boolean;
  historicalSampleSize?: number | null;
  filingLagDays?: number | null;
};

function derivePenaltyFromSampleSize(historicalSampleSize: number | null | undefined) {
  if (historicalSampleSize == null) return 0;

  if (historicalSampleSize <= 0) return 4;
  if (historicalSampleSize === 1) return 3;
  if (historicalSampleSize === 2) return 2;
  if (historicalSampleSize <= 4) return 1;

  return 0;
}

function derivePenaltyFromFilingLag(filingLagDays: number | null | undefined) {
  if (filingLagDays == null) return 0;
  if (filingLagDays > 90) return 2;
  if (filingLagDays > 45) return 1;
  return 0;
}

function getConfidenceLabel(tier: SignalConfidenceTier): SignalConfidenceTierResult["label"] {
  if (tier === "high") return "High confidence";
  if (tier === "medium") return "Medium confidence";
  return "Low confidence";
}

function mapPenaltyToTier(confidencePenalty: number): SignalConfidenceTier {
  if (confidencePenalty <= 3) return "high";
  if (confidencePenalty <= 6) return "medium";
  return "low";
}

export function getSignalConfidenceTier(
  input: SignalConfidenceTierInput
): SignalConfidenceTierResult {
  const hasExplicitPenalty =
    input.confidencePenalty != null && Number.isFinite(input.confidencePenalty);

  const confidencePenalty = hasExplicitPenalty
    ? Number(input.confidencePenalty)
    : derivePenaltyFromSampleSize(input.historicalSampleSize) +
      (input.hasReturn30d ? 0 : 3) +
      (input.hasReturn7d ? 0 : 2) +
      derivePenaltyFromFilingLag(input.filingLagDays);

  const tier = mapPenaltyToTier(confidencePenalty);

  return {
    tier,
    label: getConfidenceLabel(tier),
    confidencePenalty,
    isDerived: !hasExplicitPenalty,
  };
}
