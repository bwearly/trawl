export type FilingFreshnessLabel =
  | "Fresh"
  | "Normal"
  | "Delayed"
  | "Stale"
  | "Historical"
  | "Unknown";

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
  if (filingLagDays > 365) return "Historical";
  return "Stale";
}

export function getFilingFreshnessRank(filingLagDays: number | null): number {
  const label = getFilingFreshnessLabel(filingLagDays);
  if (label === "Fresh") return 0;
  if (label === "Normal") return 1;
  if (label === "Delayed") return 2;
  if (label === "Stale") return 3;
  if (label === "Historical") return 4;
  return 5;
}

export function isRecentlyFiled(filingDate: Date | string | null, now = new Date()): boolean {
  if (!filingDate) return false;
  const filedAt = filingDate instanceof Date ? filingDate : new Date(filingDate);
  if (Number.isNaN(filedAt.getTime())) return false;

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const deltaMs = now.getTime() - filedAt.getTime();

  return deltaMs >= 0 && deltaMs <= THIRTY_DAYS_MS;
}
