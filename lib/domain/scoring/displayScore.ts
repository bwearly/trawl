export type DisplayScoreInput = {
  rawScore: number | string | null | undefined;
  filingLagDays?: number | null;
  filingDate?: Date | string | null;
  ticker?: string | null;
  signalStatus?: string | null;
  hasReturn7d?: boolean;
  hasReturn30d?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapRawToDisplay(raw: number) {
  if (raw < 40) return 35 + (raw / 40) * 20; // 35-55
  if (raw < 55) return 55 + ((raw - 40) / 15) * 15; // 55-70
  if (raw < 65) return 70 + ((raw - 55) / 10) * 10; // 70-80
  if (raw < 75) return 80 + ((raw - 65) / 10) * 10; // 80-90
  return 90 + ((Math.min(raw, 100) - 75) / 25) * 6; // 90-96
}

function daysSinceDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

export function getSignalDisplayScore(input: DisplayScoreInput) {
  const raw = clamp(toNumber(input.rawScore), 0, 100);
  let display = mapRawToDisplay(raw);

  const filingAgeDays = daysSinceDate(input.filingDate);
  const lagDays = input.filingLagDays ?? null;
  const missingTicker = !input.ticker;
  const missingPerformance = !input.hasReturn7d && !input.hasReturn30d;
  const lowConfidence = input.signalStatus === "low_confidence" || input.signalStatus === "insufficient_data";

  if (lagDays != null && lagDays > 90) display = Math.min(display, 74);
  if (lagDays != null && lagDays > 365) display = Math.min(display, 62);
  if (filingAgeDays != null && filingAgeDays > 365) display = Math.min(display, 58);
  if (missingTicker) display = Math.min(display, 68);
  if (missingPerformance) display = Math.min(display, 84);
  if (lowConfidence) display = Math.min(display, 64);

  return Math.round(clamp(display, 0, 100));
}

export function getSignalDisplayLabel(score: number) {
  if (score >= 90) return "Exceptional";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Worth reviewing";
  if (score >= 55) return "Moderate";
  return "Low priority";
}

export function getSignalDisplayTone(score: number) {
  if (score >= 80) return "high" as const;
  if (score >= 70) return "good" as const;
  if (score >= 55) return "medium" as const;
  return "low" as const;
}
