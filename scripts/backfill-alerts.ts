import { DEMO_FALLBACK_USER_ID } from "../lib/auth/auth-identity";
import {
  backfillAlertsForAllUsers,
  backfillAlertsForUser,
} from "../lib/domain/alerts/alerts";

function normalizeScriptUserId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function main() {
  const requestedUserId = normalizeScriptUserId(process.env.ALERT_BACKFILL_USER_ID);

  if (requestedUserId) {
    console.log(`Backfilling alerts for userId=${requestedUserId}`);
    const result = await backfillAlertsForUser(requestedUserId);
    console.log("Finished backfilling alerts.");
    console.log(result);
    return;
  }

  if (DEMO_FALLBACK_USER_ID) {
    console.log("No ALERT_BACKFILL_USER_ID set. Running all-user mode.");
    console.log(
      `Tip: set ALERT_BACKFILL_USER_ID=${DEMO_FALLBACK_USER_ID} for single-user testing.`,
    );
  }

  const summary = await backfillAlertsForAllUsers();
  console.log("Finished backfilling alerts in all-user mode.");
  console.log(summary);
}

main().catch((error) => {
  console.error("Failed to backfill alerts:", error);
  process.exit(1);
});
