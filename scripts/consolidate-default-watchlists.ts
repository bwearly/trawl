import { db } from "@/lib/db";
import { users, watchlistItems, watchlists } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

type DefaultWatchlistRow = {
  id: number;
  userId: string;
  createdAt: Date;
  itemCount: number;
};

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid boolean env value \"${value}\". Expected true or false.`);
}

function normalizeEmail(value: string | undefined): string | null {
  if (!value) return null;
  const n = value.trim().toLowerCase();
  return n.length ? n : null;
}

async function resolveUserId(targetUserId: string | null, targetEmail: string | null) {
  if (targetUserId) return targetUserId;
  if (!targetEmail) throw new Error("Either TARGET_USER_ID or TARGET_EMAIL is required.");
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(trim(${users.email})) = ${targetEmail}`)
    .orderBy(asc(users.createdAt));
  if (found.length === 0) throw new Error(`No user found for TARGET_EMAIL=${targetEmail}`);
  if (found.length > 1) {
    throw new Error(`TARGET_EMAIL=${targetEmail} maps to multiple users. Use TARGET_USER_ID explicitly.`);
  }
  return found[0].id;
}

function chooseCanonical(defaults: DefaultWatchlistRow[], explicitId: number | null) {
  if (explicitId != null) {
    const match = defaults.find((d) => d.id === explicitId);
    if (!match) throw new Error(`CANONICAL_WATCHLIST_ID=${explicitId} is not one of this user's default watchlists.`);
    return match;
  }

  const sorted = [...defaults].sort((a, b) => {
    if (b.itemCount !== a.itemCount) return b.itemCount - a.itemCount;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
    return a.id - b.id;
  });
  return sorted[0];
}

async function main() {
  const dryRun = parseBoolEnv(process.env.DRY_RUN, true);
  const confirm = parseBoolEnv(process.env.CONFIRM_CONSOLIDATE, false);
  const targetUserIdInput = process.env.TARGET_USER_ID?.trim() || null;
  const targetEmail = normalizeEmail(process.env.TARGET_EMAIL);
  const explicitCanonicalId = process.env.CANONICAL_WATCHLIST_ID
    ? Number(process.env.CANONICAL_WATCHLIST_ID)
    : null;

  if (explicitCanonicalId != null && !Number.isFinite(explicitCanonicalId)) {
    throw new Error("CANONICAL_WATCHLIST_ID must be numeric when provided.");
  }

  const targetUserId = await resolveUserId(targetUserIdInput, targetEmail);

  const defaultRows = await db
    .select({
      id: watchlists.id,
      userId: watchlists.userId,
      createdAt: watchlists.createdAt,
      itemCount: sql<number>`count(${watchlistItems.id})::int`,
    })
    .from(watchlists)
    .leftJoin(watchlistItems, eq(watchlistItems.watchlistId, watchlists.id))
    .where(and(eq(watchlists.userId, targetUserId), eq(watchlists.isDefault, true)))
    .groupBy(watchlists.id, watchlists.userId, watchlists.createdAt)
    .orderBy(desc(sql<number>`count(${watchlistItems.id})::int`), asc(watchlists.createdAt), asc(watchlists.id));

  if (defaultRows.length <= 1) {
    console.log(JSON.stringify({
      status: "no-op",
      reason: defaultRows.length === 0 ? "No default watchlist found." : "User already has a single default watchlist.",
      dryRun,
      confirm,
      targetUserId,
      targetEmail,
      defaults: defaultRows,
    }, null, 2));
    return;
  }

  const canonical = chooseCanonical(defaultRows, explicitCanonicalId);
  const duplicates = defaultRows.filter((row) => row.id !== canonical.id);

  const duplicateItems = await db
    .select({
      id: watchlistItems.id,
      sourceWatchlistId: watchlistItems.watchlistId,
      itemType: watchlistItems.itemType,
      ticker: watchlistItems.ticker,
      politicianId: watchlistItems.politicianId,
      createdAt: watchlistItems.createdAt,
    })
    .from(watchlistItems)
    .where(inArray(watchlistItems.watchlistId, duplicates.map((d) => d.id)))
    .orderBy(asc(watchlistItems.watchlistId), asc(watchlistItems.id));

  const movePlan = duplicateItems.map((item) => ({
    itemId: item.id,
    fromWatchlistId: item.sourceWatchlistId,
    toWatchlistId: canonical.id,
    itemType: item.itemType,
    ticker: item.ticker,
    politicianId: item.politicianId,
    createdAt: item.createdAt,
  }));

  const result: Record<string, unknown> = {
    status: dryRun ? "dry-run" : "pending-confirmation",
    reason: dryRun
      ? "Dry run complete. No rows modified."
      : !confirm
      ? "Refusing write: CONFIRM_CONSOLIDATE must be true when DRY_RUN=false."
      : "Consolidation committed.",
    dryRun,
    confirmConsolidate: confirm,
    targetUserId,
    targetEmail,
    canonicalWatchlistId: canonical.id,
    duplicateDefaultWatchlistIds: duplicates.map((d) => d.id),
    movePlan,
    nonDefaultPlan: duplicates.map((d) => d.id),
    movedItemIds: [] as number[],
    skippedDuplicateItemIds: [] as number[],
    demotedWatchlistIds: [] as number[],
    deletedWatchlistIds: [] as number[],
  };

  if (dryRun || !confirm) {
    console.log(JSON.stringify(result, null, 2));
    if (!dryRun && !confirm) process.exitCode = 1;
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of duplicateItems) {
      const inserted = await tx
        .insert(watchlistItems)
        .values({
          watchlistId: canonical.id,
          itemType: item.itemType,
          ticker: item.ticker,
          politicianId: item.politicianId,
        })
        .onConflictDoNothing()
        .returning({ id: watchlistItems.id });

      if (inserted.length > 0) {
        (result.movedItemIds as number[]).push(item.id);
      } else {
        (result.skippedDuplicateItemIds as number[]).push(item.id);
      }
    }

    await tx
      .update(watchlists)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(inArray(watchlists.id, duplicates.map((d) => d.id)))
      .returning({ id: watchlists.id })
      .then((rows) => {
        (result.demotedWatchlistIds as number[]).push(...rows.map((r) => r.id));
      });
  });

  result.status = "committed";
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
