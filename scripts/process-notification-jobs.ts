import { processNotificationJobs } from "@/lib/domain/notifications/process-notification-jobs";

async function main() {
  const batchSize = 25;
  const result = await processNotificationJobs(batchSize);
  console.log("Processed notification jobs:", result);
}

main().catch((error) => {
  console.error("Failed to process notification jobs:", error);
  process.exit(1);
});
