import { getCurrentUserId } from "@/lib/auth/get-current-user-id";
import { backfillAlertsForUser } from "@/lib/domain/alerts/alerts";

async function main() {
  const userId = await getCurrentUserId();
  console.log(`Backfilling alerts for user: ${userId}`);

  const result = await backfillAlertsForUser(userId);

  console.log("Finished backfilling alerts.");
  console.log(result);
}

main().catch((error) => {
  console.error("Failed to backfill alerts:", error);
  process.exit(1);
});
