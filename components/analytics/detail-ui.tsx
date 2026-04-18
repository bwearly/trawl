type Tone = "neutral" | "positive" | "negative" | "mixed";

type DetailStatCardProps = {
  label: string;
  value: string;
  tone?: Tone;
  supportingText?: string;
};

const toneClassMap: Record<Tone, string> = {
  neutral: "text-gray-900",
  positive: "text-emerald-600",
  negative: "text-rose-600",
  mixed: "text-amber-600",
};

export function toneToClass(tone: Tone) {
  return toneClassMap[tone];
}

export function getPerformanceTone(value: number | null): Tone {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export function getWinRateTone(value: number | null): Tone {
  if (value === null) return "neutral";
  if (value >= 55) return "positive";
  if (value < 50) return "negative";
  return "mixed";
}

export function formatPercent(value: number | null) {
  if (value === null) return "Not enough data yet";
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function formatDate(value: Date | string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString();
}

export function getMetricTone(value: string): Tone {
  if (value.startsWith("+")) return "positive";
  if (value.startsWith("-")) return "negative";
  if (value === "Not enough data yet") return "neutral";
  return "neutral";
}

export function DetailStatCard({
  label,
  value,
  tone = "neutral",
  supportingText,
}: DetailStatCardProps) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${toneClassMap[tone]}`}
      >
        {value}
      </p>
      {supportingText ? (
        <p className="mt-2 text-sm leading-6 text-gray-500">{supportingText}</p>
      ) : null}
    </article>
  );
}
