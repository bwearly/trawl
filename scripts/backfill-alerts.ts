import { DEMO_FALLBACK_USER_ID } from "../lib/auth/auth-identity";
import { backfillAlertsForUser } from "../lib/domain/alerts/alerts";

function normalizeScriptUserId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function main() {
  const requestedUserId = process.env.ALERT_BACKFILL_USER_ID;
  const userId = normalizeScriptUserId(requestedUserId) ?? DEMO_FALLBACK_USER_ID;
  console.log(`Backfilling alerts for userId=${userId}`);

  const result = await backfillAlertsForUser(userId);

  console.log("Finished backfilling alerts.");
  console.log(result);
}

main().catch((error) => {
  console.error("Failed to backfill alerts:", error);
  process.exit(1);
});
