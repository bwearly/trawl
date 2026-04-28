export type FilingFreshnessLabel = "Fresh" | "Normal" | "Delayed" | "Stale" | "Unknown";

export function getFilingLagPenalty(filingLagDays: number | null): number {
  if (filingLagDays == null) return 8;
  if (filingLagDays <= 15) return 0;
  if (filingLagDays <= 45) return 3;
  if (filingLagDays <= 90) return 7;
  if (filingLagDays <= 180) return 12;
  return 18;
}

export function getFilingFreshnessLabel(
  filingLagDays: number | null
): FilingFreshnessLabel {
  if (filingLagDays == null) return "Unknown";
  if (filingLagDays <= 15) return "Fresh";
  if (filingLagDays <= 45) return "Normal";
  if (filingLagDays <= 90) return "Delayed";
  return "Stale";
}

export function getFilingFreshnessRank(filingLagDays: number | null): number {
  const label = getFilingFreshnessLabel(filingLagDays);
  if (label === "Fresh") return 0;
  if (label === "Normal") return 1;
  if (label === "Delayed") return 2;
  if (label === "Stale") return 3;
  return 4;
}
