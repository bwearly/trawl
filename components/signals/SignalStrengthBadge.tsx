import type { AlertTier } from "@/lib/domain/alerts/should-generate-alert";

type SignalStrengthBadgeProps = {
  tier: AlertTier | null;
};

export default function SignalStrengthBadge({ tier }: SignalStrengthBadgeProps) {
  if (!tier) return null;

  const isHighConviction = tier === "high_conviction";
  const label = isHighConviction ? "High Conviction" : "Alert Eligible";
  const helperText = isHighConviction
    ? "High-conviction research signal with strong recency and score."
    : "Alert eligible means this signal is recent and actionable enough for alerts.";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        isHighConviction
          ? "bg-slate-900 text-white ring-slate-700"
          : "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
      title={helperText}
      aria-label={`${label}: ${helperText}`}
    >
      {label}
    </span>
  );
}
