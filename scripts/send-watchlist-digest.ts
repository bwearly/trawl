import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { notificationJobs, watchlistDigestDeliveries } from "@/lib/db/schema";
import { enqueueEmailNotificationJob } from "@/lib/domain/notifications/enqueue-notification";
import { processNotificationJobs } from "@/lib/domain/notifications/process-notification-jobs";
import { buildWatchlistDailyDigest } from "@/lib/domain/watchlists/daily-digest";
import { buildDigestJobIdempotencyKey, shouldRecordDigestDelivery } from "@/lib/domain/watchlists/digest-delivery";
import { renderWatchlistDigestEmail } from "@/lib/domain/watchlists/digest-email";

async function main() {
  const dryRun = process.env.DRY_RUN === "true";
  const baseUrl = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
  const windowHours = process.env.DIGEST_WINDOW_HOURS ? Number(process.env.DIGEST_WINDOW_HOURS) : 24;

  const sendEnabled = process.env.ALERT_EMAIL_QUEUE_ENABLED === "true";
  const effectiveDryRun = dryRun || !sendEnabled;
  const verbose = process.env.VERBOSE === "true";
  const testUserId = process.env.TEST_USER_ID?.trim() || null;
  const testUserEmail = process.env.TEST_USER_EMAIL?.trim().toLowerCase() || null;
  const { batches, summary } = await buildWatchlistDailyDigest({ windowHours, baseUrl });

  const filteredBatches = batches.filter((batch) => {
    if (testUserId && batch.userId !== testUserId) return false;
    if (testUserEmail && batch.recipient.toLowerCase() !== testUserEmail) return false;
    return true;
  });

  if (verbose) {
    console.log(JSON.stringify({
      mode: effectiveDryRun ? "dry-run" : "live",
      windowHours,
      usersWithMatchesBeforeFilter: batches.length,
      usersWithMatchesAfterFilter: filteredBatches.length,
      testUserId: testUserId ? "set" : "unset",
      testUserEmail: testUserEmail ? "set" : "unset",
    }));
  }

  let emailsAttempted = 0;
  let failures = 0;

  const enqueuedBatches: Array<{ userId: string; idempotencyKey: string; signalIds: number[] }> = [];

  for (const batch of filteredBatches) {
    const content = renderWatchlistDigestEmail(batch);
    emailsAttempted += 1;

    if (effectiveDryRun) {
      console.log(`[dry-run] would send digest user=${batch.userId} recipient=${batch.recipient} signals=${batch.signals.length}`);
      continue;
    }

    const sortedSignalIds = [...batch.signals.map((s) => s.researchSignalId)].sort((a, b) => a - b);
    const idempotencyKey = buildDigestJobIdempotencyKey(batch.userId, sortedSignalIds);

    const enqueue = await enqueueEmailNotificationJob({
      alertId: null,
      userId: batch.userId,
      recipient: batch.recipient,
      idempotencyKey,
      subject: content.subject,
      textBody: content.text,
      htmlBody: content.html,
    });

    if (enqueue.enqueued || enqueue.reason === "already_exists") {
      enqueuedBatches.push({ userId: batch.userId, idempotencyKey, signalIds: sortedSignalIds });
    } else {
      failures += 1;
    }
  }

  const queueResult = effectiveDryRun ? { processed: 0, fetched: 0 } : await processNotificationJobs(100);

  if (!effectiveDryRun) {
    for (const batch of enqueuedBatches) {
      const rows = await db
        .select({ status: notificationJobs.status })
        .from(notificationJobs)
        .where(and(eq(notificationJobs.userId, batch.userId), eq(notificationJobs.idempotencyKey, batch.idempotencyKey)))
        .limit(1);

      const status = rows[0]?.status ?? null;
      if (shouldRecordDigestDelivery(status)) {
        await db
          .insert(watchlistDigestDeliveries)
          .values(
            batch.signalIds.map((researchSignalId) => ({
              userId: batch.userId,
              researchSignalId,
              deliveryType: "daily_digest",
              status: "sent",
              sentAt: new Date(),
            }))
          )
          .onConflictDoNothing();
      }
    }
  }

  console.log(JSON.stringify({
    ...summary,
    usersWithMatches: filteredBatches.length,
    emailsAttempted,
    emailsSent: queueResult.processed,
    failures,
    dryRun: effectiveDryRun,
  }));
}

main().catch((error) => {
  console.error("Failed to send watchlist digest:", error);
  process.exit(1);
});
