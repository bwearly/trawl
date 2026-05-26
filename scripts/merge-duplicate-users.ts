import { db } from "@/lib/db";
import {
  alertPreferences,
  alerts,
  notificationEvents,
  notificationJobs,
  users,
  watchlistDigestDeliveries,
  watchlistItems,
  watchlists,
} from "@/lib/db/schema";
import { asc, eq, sql } from "drizzle-orm";

const DRY_RUN = (process.env.DRY_RUN ?? "true") !== "false";
const TARGET_EMAIL = process.env.TARGET_EMAIL?.trim().toLowerCase();
const CANONICAL_USER_ID = process.env.CANONICAL_USER_ID?.trim();
const CONFIRM_MERGE = process.env.CONFIRM_MERGE === "true";

if (!TARGET_EMAIL && !CANONICAL_USER_ID) {
  throw new Error("Set TARGET_EMAIL or CANONICAL_USER_ID.");
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

async function main() {
  const targetUsers = TARGET_EMAIL
    ? await db
        .select({ id: users.id, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(sql`lower(trim(${users.email})) = ${TARGET_EMAIL}`)
        .orderBy(asc(users.createdAt))
    : await db
        .select({ id: users.id, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, CANONICAL_USER_ID!));

  if (targetUsers.length < 2 && !TARGET_EMAIL) {
    console.log("Single user resolved by CANONICAL_USER_ID. No merge candidates.");
    return;
  }

  if (targetUsers.length < 2) {
    console.log("No duplicates found for TARGET_EMAIL.");
    return;
  }

  const scored = await Promise.all(
    targetUsers.map(async (u) => {
      const [wItems] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(watchlistItems)
        .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
        .where(eq(watchlists.userId, u.id));
      const [prefs] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alertPreferences)
        .where(eq(alertPreferences.userId, u.id));
      const [digests] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(watchlistDigestDeliveries)
        .where(eq(watchlistDigestDeliveries.userId, u.id));

      return {
        ...u,
        score:
          Number(wItems?.count ?? 0) * 10 +
          Number(prefs?.count ?? 0) * 3 +
          Number(digests?.count ?? 0),
      };
    })
  );

  const canonical = CANONICAL_USER_ID
    ? scored.find((u) => u.id === CANONICAL_USER_ID)
    : [...scored].sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime())[0];

  if (!canonical) {
    throw new Error("Canonical user could not be determined.");
  }

  const duplicates = scored.filter((u) => u.id !== canonical.id);
  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        confirmMerge: CONFIRM_MERGE,
        canonicalUserId: canonical.id,
        canonicalEmail: normalizeEmail(canonical.email),
        duplicateUserIds: duplicates.map((u) => u.id),
      },
      null,
      2
    )
  );

  const duplicateIds = duplicates.map((d) => d.id);

  console.log(`Would move rows from duplicate users: ${duplicateIds.join(', ')}`);

  if (!DRY_RUN && CONFIRM_MERGE) {
    await db.update(watchlists).set({ userId: canonical.id }).where(sql`${watchlists.userId} = any(${duplicateIds})`);
    await db.update(alertPreferences).set({ userId: canonical.id }).where(sql`${alertPreferences.userId} = any(${duplicateIds})`);
    await db.update(alerts).set({ userId: canonical.id }).where(sql`${alerts.userId} = any(${duplicateIds})`);
    await db.update(notificationJobs).set({ userId: canonical.id }).where(sql`${notificationJobs.userId} = any(${duplicateIds})`);
    await db.update(notificationEvents).set({ userId: canonical.id }).where(sql`${notificationEvents.userId} = any(${duplicateIds})`);
    await db.update(watchlistDigestDeliveries).set({ userId: canonical.id }).where(sql`${watchlistDigestDeliveries.userId} = any(${duplicateIds})`);
  }

  if (!DRY_RUN && CONFIRM_MERGE) {
    console.log("Manual final step required: delete duplicate user rows only after verifying moved data.");
  } else {
    console.log("Dry-run complete. No rows were modified.");
  }
}

main().catch((error) => {
  console.error("merge-duplicate-users failed:", error);
  process.exit(1);
});
