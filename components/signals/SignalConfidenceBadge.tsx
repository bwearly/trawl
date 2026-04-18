import {
  type SignalConfidenceTier,
  getSignalConfidenceTier,
} from "@/lib/domain/signals/get-signal-confidence-tier";

type SignalConfidenceBadgeProps = {
  confidencePenalty?: number | null;
  hasReturn7d?: boolean;
  hasReturn30d?: boolean;
  historicalSampleSize?: number | null;
  filingLagDays?: number | null;
};

function getTierStyles(tier: SignalConfidenceTier) {
  if (tier === "high") {
    return "bg-slate-100 text-slate-700 ring-slate-200";
  }

  if (tier === "medium") {
    return "bg-gray-100 text-gray-700 ring-gray-200";
  }

  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

export default function SignalConfidenceBadge({
  confidencePenalty,
  hasReturn7d,
  hasReturn30d,
  historicalSampleSize,
  filingLagDays,
}: SignalConfidenceBadgeProps) {
  const confidence = getSignalConfidenceTier({
    confidencePenalty,
    hasReturn7d,
    hasReturn30d,
    historicalSampleSize,
    filingLagDays,
  });

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${getTierStyles(
        confidence.tier
      )}`}
      title={confidence.isDerived ? "Confidence is estimated from available support data." : undefined}
    >
      {confidence.label}
    </span>
  );
}
