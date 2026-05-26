export function buildDigestJobIdempotencyKey(userId: string, signalIds: number[]) {
  const sorted = [...signalIds].sort((a, b) => a - b);
  return `daily_digest:${userId}:${sorted.join(",")}`;
}

export function shouldRecordDigestDelivery(jobStatus: string | null | undefined) {
  return jobStatus === "sent";
}
