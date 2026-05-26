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
import { and, asc, eq, inArray, sql } from "drizzle-orm";

const DRY_RUN = (process.env.DRY_RUN ?? "true") !== "false";
const TARGET_EMAIL = process.env.TARGET_EMAIL?.trim().toLowerCase();
const CANONICAL_USER_ID = process.env.CANONICAL_USER_ID?.trim();
const CONFIRM_MERGE = process.env.CONFIRM_MERGE === "true";

if (!TARGET_EMAIL && !CANONICAL_USER_ID) {
  throw new Error("Set TARGET_EMAIL or CANONICAL_USER_ID.");
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

export function buildDuplicateUserCondition<TColumn>(column: TColumn, duplicateIds: string[]) {
  return inArray(column as never, duplicateIds);
}

function ensureMergeWriteEnabled() {
  if (DRY_RUN) {
    throw new Error("Refusing write: DRY_RUN=true. Set DRY_RUN=false and CONFIRM_MERGE=true to write.");
  }
  if (!CONFIRM_MERGE) {
    throw new Error("Refusing write: CONFIRM_MERGE must be true when DRY_RUN=false.");
  }
}

export async function moveUserRows(tx: typeof db, canonicalUserId: string, duplicateIds: string[]) {
  const duplicateFilter = buildDuplicateUserCondition(watchlists.userId, duplicateIds);
  const [movedWatchlists] = await tx
    .update(watchlists)
    .set({ userId: canonicalUserId })
    .where(duplicateFilter)
    .returning({ id: watchlists.id });

  const duplicateTables = [
    { name: "alertPreferences", table: alertPreferences, column: alertPreferences.userId },
    { name: "alerts", table: alerts, column: alerts.userId },
    { name: "notificationJobs", table: notificationJobs, column: notificationJobs.userId },
    { name: "notificationEvents", table: notificationEvents, column: notificationEvents.userId },
    { name: "watchlistDigestDeliveries", table: watchlistDigestDeliveries, column: watchlistDigestDeliveries.userId },
  ] as const;

  const movedCounts: Record<string, number> = {
    watchlists: movedWatchlists ? 1 : 0,
  };

  for (const item of duplicateTables) {
    const rows = await tx
      .update(item.table)
      .set({ userId: canonicalUserId })
      .where(buildDuplicateUserCondition(item.column, duplicateIds))
      .returning({ userId: item.column });
    movedCounts[item.name] = rows.length;
  }

  return movedCounts;
}

async function validateWatchlistMove(canonicalUserId: string, duplicateIds: string[]) {
  const canonicalDefault = await db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(and(eq(watchlists.userId, canonicalUserId), eq(watchlists.isDefault, true)))
    .limit(2);

  if (canonicalDefault.length > 1) {
    throw new Error(
      `Canonical user ${canonicalUserId} has multiple default watchlists. Resolve this before merge.`
    );
  }

  const duplicateDefaultRows = await db
    .select({ userId: watchlists.userId, count: sql<number>`count(*)::int` })
    .from(watchlists)
    .where(and(buildDuplicateUserCondition(watchlists.userId, duplicateIds), eq(watchlists.isDefault, true)))
    .groupBy(watchlists.userId);

  const offenders = duplicateDefaultRows.filter((row) => Number(row.count) > 1);
  if (offenders.length > 0) {
    const details = offenders.map((row) => `${row.userId}:${row.count}`).join(", ");
    throw new Error(
      `Duplicate users with multiple default watchlists found (${details}). Resolve before merge to avoid ambiguous watchlist ownership.`
    );
  }

  const totalDuplicateDefaults = duplicateDefaultRows.reduce((sum, row) => sum + Number(row.count), 0);
  if (canonicalDefault.length > 0 && totalDuplicateDefaults > 0) {
    console.warn(
      `Watchlist note: canonical user already has a default watchlist and ${totalDuplicateDefaults} duplicate default watchlist(s) will also be moved. Review post-merge and consolidate if needed.`
    );
  }
}

export async function main() {
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
  const duplicateIds = duplicates.map((d) => d.id);

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        confirmMerge: CONFIRM_MERGE,
        canonicalUserId: canonical.id,
        canonicalEmail: normalizeEmail(canonical.email),
        duplicateUserIds: duplicateIds,
      },
      null,
      2
    )
  );

  console.log(`Would move rows from duplicate users: ${duplicateIds.join(", ")}`);

  if (DRY_RUN) {
    console.log("Dry-run complete. No rows were modified.");
    return;
  }

  ensureMergeWriteEnabled();
  await validateWatchlistMove(canonical.id, duplicateIds);

  const movedCounts = await db.transaction(async (tx) => {
    return moveUserRows(tx as typeof db, canonical.id, duplicateIds);
  });

  console.log("Moved rows summary:", movedCounts);
  console.log("Manual final step required: delete duplicate user rows only after verifying moved data.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("merge-duplicate-users failed:", error);
    process.exit(1);
  });
}
