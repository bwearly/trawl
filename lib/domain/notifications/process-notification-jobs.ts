import { db } from "@/lib/db";
import { notificationEvents, notificationJobs } from "@/lib/db/schema";
import { getNotificationSender } from "@/lib/domain/notifications/sender";
import { and, asc, eq, lte, sql } from "drizzle-orm";

export async function processNotificationJobs(batchSize = 25) {
  const sender = getNotificationSender();
  const now = new Date();

  const jobs = await db
    .select()
    .from(notificationJobs)
    .where(
      and(
        eq(notificationJobs.status, "queued"),
        lte(notificationJobs.scheduledFor, now),
        sql`${notificationJobs.attemptCount} < ${notificationJobs.maxAttempts}`
      )
    )
    .orderBy(asc(notificationJobs.scheduledFor), asc(notificationJobs.id))
    .limit(batchSize);

  let processed = 0;
  for (const job of jobs) {
    const claimedRows = await db
      .update(notificationJobs)
      .set({ status: "sending", lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notificationJobs.id, job.id), eq(notificationJobs.status, "queued")))
      .returning({ id: notificationJobs.id });

    if (claimedRows.length === 0) {
      continue;
    }

    await db.insert(notificationEvents).values({
      jobId: job.id,
      alertId: job.alertId,
      userId: job.userId,
      channel: job.channel,
      eventType: "sending",
      message: "Job picked for processing.",
    });

    try {
      const sendResult = await sender.sendEmailNotification({
        userId: job.userId,
        recipient: job.recipient,
        alertId: job.alertId,
        idempotencyKey: job.idempotencyKey,
      });

      if (sendResult.status === "sent") {
        await db
          .update(notificationJobs)
          .set({
            status: "sent",
            sentAt: new Date(),
            providerMessageId: sendResult.providerMessageId ?? null,
            attemptCount: job.attemptCount + 1,
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, job.id));

        await db.insert(notificationEvents).values({
          jobId: job.id,
          alertId: job.alertId,
          userId: job.userId,
          channel: job.channel,
          eventType: "sent",
          message: sendResult.message ?? "Notification marked sent.",
        });
      } else if (sendResult.status === "suppressed") {
        await db
          .update(notificationJobs)
          .set({
            status: "suppressed",
            attemptCount: job.attemptCount + 1,
            errorCode: "suppressed",
            errorMessage: sendResult.message ?? null,
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, job.id));

        await db.insert(notificationEvents).values({
          jobId: job.id,
          alertId: job.alertId,
          userId: job.userId,
          channel: job.channel,
          eventType: "suppressed",
          message: sendResult.message ?? "Notification suppressed.",
        });
      } else {
        await db
          .update(notificationJobs)
          .set({
            status: "sent",
            sentAt: new Date(),
            attemptCount: job.attemptCount + 1,
            errorCode: null,
            errorMessage: sendResult.message ?? null,
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, job.id));

        await db.insert(notificationEvents).values({
          jobId: job.id,
          alertId: job.alertId,
          userId: job.userId,
          channel: job.channel,
          eventType: "noop",
          message: sendResult.message ?? "No-op sender executed.",
        });
      }
    } catch (error) {
      const retries = job.attemptCount + 1;
      const exhausted = retries >= job.maxAttempts;

      await db
        .update(notificationJobs)
        .set({
          status: exhausted ? "failed" : "queued",
          attemptCount: retries,
          errorCode: "sender_exception",
          errorMessage: error instanceof Error ? error.message : "unknown sender error",
          updatedAt: new Date(),
        })
        .where(eq(notificationJobs.id, job.id));

      await db.insert(notificationEvents).values({
        jobId: job.id,
        alertId: job.alertId,
        userId: job.userId,
        channel: job.channel,
        eventType: "failed",
        message:
          error instanceof Error
            ? `Notification send failed: ${error.message}`
            : "Notification send failed: unknown sender error.",
      });
    }

    processed += 1;
  }

  return { processed, fetched: jobs.length };
}
