import { db } from "@/lib/db";
import { notificationEvents, notificationJobs } from "@/lib/db/schema";

export async function enqueueEmailNotificationJob(input: {
  alertId: number;
  userId: string;
  recipient?: string | null;
  idempotencyKey: string;
}) {
  const rows = await db
    .insert(notificationJobs)
    .values({
      alertId: input.alertId,
      userId: input.userId,
      channel: "email",
      recipient: input.recipient ?? null,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      attemptCount: 0,
      maxAttempts: 3,
      scheduledFor: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({
      id: notificationJobs.id,
    });

  const job = rows[0];
  if (!job) {
    return { enqueued: false, reason: "already_exists" as const };
  }

  await db.insert(notificationEvents).values({
    jobId: job.id,
    alertId: input.alertId,
    userId: input.userId,
    channel: "email",
    eventType: "queued",
    message: "Notification job queued.",
  });

  return { enqueued: true, jobId: job.id as number };
}
