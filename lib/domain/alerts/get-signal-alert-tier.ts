import { shouldGenerateAlert, type AlertTier } from "@/lib/domain/alerts/should-generate-alert";

type SignalAlertTierInput = {
  score: string | number;
  signalStatus: string;
  tradeType: string;
  filingLagDays?: number | null;
  confidencePenalty?: number | null;
};

export function getSignalAlertTier(input: SignalAlertTierInput): AlertTier | null {
  const adjustedScore = Number(input.score);

  if (!Number.isFinite(adjustedScore)) {
    return null;
  }

  const eligibility = shouldGenerateAlert({
    signalStatus: input.signalStatus,
    tradeType: input.tradeType,
    adjustedScore,
    confidencePenalty: input.confidencePenalty ?? null,
    filingLagDays: input.filingLagDays,
  });

  return eligibility.shouldAlert ? eligibility.tier : null;
}
