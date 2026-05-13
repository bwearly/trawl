export type PricePoint = {
  date: Date;
  close: number | null;
};

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function calcReturnPercent(start: number, end: number): number {
  if (start === 0) return 0;
  return round2(((end - start) / start) * 100);
}

export function calcAlphaPercent(
  stockReturn: number | null,
  benchmarkReturn: number | null
): number | null {
  if (stockReturn == null || benchmarkReturn == null) return null;
  return round2(stockReturn - benchmarkReturn);
}

export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function findClosestPriceOnOrAfter(
  rows: PricePoint[],
  targetDate: Date
): PricePoint | null {
  const target = startOfUtcDay(targetDate).getTime();
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const row of sorted) {
    if (startOfUtcDay(row.date).getTime() >= target) return row;
  }
  return null;
}
