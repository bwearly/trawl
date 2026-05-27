type SignalScoreBreakdownAccordionProps = {
  score: number | string;
  signalStage?: string | null;
  filingLagDays: number | null;
  return7d?: number | string | null;
  return30d?: number | string | null;
  tradeTypeScore?: number | string | null;
  tradeSizeScore?: number | string | null;
  filingFreshnessScore?: number | string | null;
  historicalPoliticianScore?: number | string | null;
  momentumScore?: number | string | null;
  className?: string;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function formatComponentScore(value: number | string | null | undefined) {
  const numeric = toNumber(value);
  if (numeric == null) return null;
  return Math.round(numeric * 10) / 10;
}

export default function SignalScoreBreakdownAccordion({
  score,
  signalStage,
  filingLagDays,
  return7d,
  return30d,
  tradeTypeScore,
  tradeSizeScore,
  filingFreshnessScore,
  historicalPoliticianScore,
  momentumScore,
  className = "",
}: SignalScoreBreakdownAccordionProps) {
  const numericScore = toNumber(score) ?? 0;
  const stage = signalStage ?? "fresh";
  const missingPerformanceData = return7d == null && return30d == null;

  const cautionReasons: string[] = [];
  if (missingPerformanceData)
    cautionReasons.push("Limited performance history (7d/30d windows unavailable)");
  if (filingLagDays != null && filingLagDays > 90)
    cautionReasons.push("Stale filing lag reduces actionability");
  if (filingLagDays != null && filingLagDays > 365)
    cautionReasons.push("Historical disclosure timing");

  const whyReasons = [
    { label: "Trade type", score: formatComponentScore(tradeTypeScore) },
    { label: "Trade size", score: formatComponentScore(tradeSizeScore) },
    { label: "Filing freshness", score: formatComponentScore(filingFreshnessScore) },
    {
      label: "Historical politician context",
      score: formatComponentScore(historicalPoliticianScore),
    },
    { label: "Recent momentum context", score: formatComponentScore(momentumScore) },
  ].filter((item) => item.score != null);

  return (
    <details className={`rounded-xl border border-gray-200 bg-white p-3 ${className}`.trim()}>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-600">
        Why this score?
      </summary>
      <div className="mt-2 space-y-2 text-xs text-gray-700">
        <p>
          <span className="font-medium text-gray-500">Score</span>: {Math.round(numericScore)}/100 ·{" "}
          <span className="font-medium text-gray-500">Stage</span>: {stage}
        </p>
        <p>
          <span className="font-medium text-gray-500">Filing lag</span>: {" "}
          {filingLagDays != null ? `${filingLagDays} days` : "Not available"}
        </p>
        <p>
          <span className="font-medium text-gray-500">Performance windows</span>: {" "}
          {missingPerformanceData ? "Missing (limited confidence)" : "Available"}
        </p>
        {whyReasons.length > 0 ? (
          <div>
            <p className="font-medium text-gray-500">Top positive components</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {whyReasons
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .slice(0, 3)
                .map((item) => (
                  <li key={item.label}>
                    {item.label}: +{item.score?.toFixed(1)}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="font-medium text-gray-500">Cautions</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {cautionReasons.length > 0 ? (
              cautionReasons.map((caution) => <li key={caution}>{caution}</li>)
            ) : (
              <li>No major caution flags from filing timeliness/performance availability.</li>
            )}
          </ul>
        </div>
      </div>
    </details>
  );
}
