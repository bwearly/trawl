import { backfillAlertsForDemoUser } from "@/lib/domain/alerts/alerts";

async function main() {
  console.log("Backfilling alerts for demo user...");

  const result = await backfillAlertsForDemoUser();

  console.log("Finished backfilling alerts.");
  console.log(result);
}

main().catch((error) => {
  console.error("Failed to backfill alerts:", error);
  process.exit(1);
});