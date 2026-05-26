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

type MoveCounts = Record<string, number>;

type MergeResult = {
  status: "dry-run" | "committed" | "blocked" | "error" | "no-op";
  reason: string;
  dryRun: boolean;
  confirmMerge: boolean;
  targetEmail: string | null;
  canonicalUserIdInput: string | null;
  canonicalUserIdResolved: string | null;
  duplicateUserIds: string[];
  plannedRowMovesByTable: MoveCounts;
  movedRowsByTable: MoveCounts;
  transactionCommitted: boolean;
  skippedOrConflictingRows: string[];
  blockingWarningsOrErrors: string[];
  manualNextSteps: string[];
};

export function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid boolean env value \"${value}\". Expected true or false.`);
}

function getConfig() {
  const targetEmail = normalizeEmail(process.env.TARGET_EMAIL);
  const canonicalUserId = process.env.CANONICAL_USER_ID?.trim() || null;
  const dryRun = parseBoolEnv(process.env.DRY_RUN, true);
  const confirmMerge = parseBoolEnv(process.env.CONFIRM_MERGE, false);
  return { targetEmail, canonicalUserId, dryRun, confirmMerge };
}

export function buildDuplicateUserCondition<TColumn>(column: TColumn, duplicateIds: string[]) {
  return inArray(column as never, duplicateIds);
}

async function countPlannedMoves(canonicalUserId: string, duplicateIds: string[]): Promise<MoveCounts> {
  const byTable: MoveCounts = {};

  const [watchlistsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlists)
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds));
  byTable.watchlists = Number(watchlistsCount?.count ?? 0);

  const countingTables = [
    { name: "alertPreferences", table: alertPreferences, column: alertPreferences.userId },
    { name: "alerts", table: alerts, column: alerts.userId },
    { name: "notificationJobs", table: notificationJobs, column: notificationJobs.userId },
    { name: "notificationEvents", table: notificationEvents, column: notificationEvents.userId },
    { name: "watchlistDigestDeliveries", table: watchlistDigestDeliveries, column: watchlistDigestDeliveries.userId },
  ] as const;

  for (const item of countingTables) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(item.table)
      .where(buildDuplicateUserCondition(item.column, duplicateIds));
    byTable[item.name] = Number(row?.count ?? 0);
  }

  byTable.watchlistItems = 0;
  const [itemsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds));
  byTable.watchlistItems = Number(itemsCount?.count ?? 0);

  // This count is diagnostic only; watchlist items move implicitly through watchlist ownership updates.
  if (canonicalUserId.length === 0) {
    throw new Error("Canonical user ID cannot be empty.");
  }

  return byTable;
}

export async function moveUserRows(tx: typeof db, canonicalUserId: string, duplicateIds: string[]) {
  const movedWatchlists = await tx
    .update(watchlists)
    .set({ userId: canonicalUserId })
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds))
    .returning({ id: watchlists.id });

  const duplicateTables = [
    { name: "alertPreferences", table: alertPreferences, column: alertPreferences.userId },
    { name: "alerts", table: alerts, column: alerts.userId },
    { name: "notificationJobs", table: notificationJobs, column: notificationJobs.userId },
    { name: "notificationEvents", table: notificationEvents, column: notificationEvents.userId },
    { name: "watchlistDigestDeliveries", table: watchlistDigestDeliveries, column: watchlistDigestDeliveries.userId },
  ] as const;

  const movedCounts: MoveCounts = {
    watchlists: movedWatchlists.length,
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
  const issues: string[] = [];

  const canonicalDefault = await db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(and(eq(watchlists.userId, canonicalUserId), eq(watchlists.isDefault, true)));

  if (canonicalDefault.length > 1) {
    issues.push(
      `Canonical user has multiple default watchlists: ${canonicalDefault.map((r) => r.id).join(", ")}`
    );
  }

  const duplicateDefaultRows = await db
    .select({ id: watchlists.id, userId: watchlists.userId })
    .from(watchlists)
    .where(and(buildDuplicateUserCondition(watchlists.userId, duplicateIds), eq(watchlists.isDefault, true)));

  const grouped = new Map<string, string[]>();
  for (const row of duplicateDefaultRows) {
    grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row.id]);
  }

  for (const [userId, watchlistIds] of grouped.entries()) {
    if (watchlistIds.length > 1) {
      issues.push(`Duplicate user ${userId} has multiple default watchlists: ${watchlistIds.join(", ")}`);
    }
  }

  const warnings: string[] = [];
  const totalDuplicateDefaults = duplicateDefaultRows.length;
  if (canonicalDefault.length > 0 && totalDuplicateDefaults > 0) {
    warnings.push(
      `Canonical user already has a default watchlist and ${totalDuplicateDefaults} duplicate default watchlist(s) will also be moved.`
    );
  }

  return { issues, warnings };
}

function emitFinalResult(result: MergeResult, exitCode: number) {
  console.log(JSON.stringify(result, null, 2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export async function main() {
  const result: MergeResult = {
    status: "no-op",
    reason: "Initialized",
    dryRun: true,
    confirmMerge: false,
    targetEmail: null,
    canonicalUserIdInput: null,
    canonicalUserIdResolved: null,
    duplicateUserIds: [],
    plannedRowMovesByTable: {},
    movedRowsByTable: {},
    transactionCommitted: false,
    skippedOrConflictingRows: [],
    blockingWarningsOrErrors: [],
    manualNextSteps: [],
  };

  try {
    const { targetEmail, canonicalUserId, dryRun, confirmMerge } = getConfig();
    result.targetEmail = targetEmail;
    result.canonicalUserIdInput = canonicalUserId;
    result.dryRun = dryRun;
    result.confirmMerge = confirmMerge;

    if (!targetEmail && !canonicalUserId) {
      throw new Error("Missing required input: set TARGET_EMAIL or CANONICAL_USER_ID.");
    }

    const targetUsers = targetEmail
      ? await db
          .select({ id: users.id, email: users.email, createdAt: users.createdAt })
          .from(users)
          .where(sql`lower(trim(${users.email})) = ${targetEmail}`)
          .orderBy(asc(users.createdAt))
      : await db
          .select({ id: users.id, email: users.email, createdAt: users.createdAt })
          .from(users)
          .where(eq(users.id, canonicalUserId!));

    if (targetUsers.length === 0) {
      result.status = "error";
      result.reason = targetEmail
        ? `No users found for TARGET_EMAIL=${targetEmail}.`
        : `No user found for CANONICAL_USER_ID=${canonicalUserId}.`;
      return emitFinalResult(result, 1);
    }

    if (targetUsers.length < 2) {
      result.status = "no-op";
      result.reason = targetEmail
        ? `No duplicate users found for TARGET_EMAIL=${targetEmail}.`
        : `Only CANONICAL_USER_ID=${canonicalUserId} was resolved; no duplicate users to move.`;
      return emitFinalResult(result, 0);
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
          score: Number(wItems?.count ?? 0) * 10 + Number(prefs?.count ?? 0) * 3 + Number(digests?.count ?? 0),
        };
      })
    );

    const canonical = canonicalUserId
      ? scored.find((u) => u.id === canonicalUserId)
      : [...scored].sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!canonical) {
      throw new Error(`Canonical user could not be resolved from CANONICAL_USER_ID=${canonicalUserId}.`);
    }

    const duplicateIds = scored.filter((u) => u.id !== canonical.id).map((d) => d.id);
    result.canonicalUserIdResolved = canonical.id;
    result.duplicateUserIds = duplicateIds;

    if (duplicateIds.length === 0) {
      result.status = "no-op";
      result.reason = "No duplicate users to move after canonical resolution.";
      return emitFinalResult(result, 0);
    }

    result.plannedRowMovesByTable = await countPlannedMoves(canonical.id, duplicateIds);

    const watchlistValidation = await validateWatchlistMove(canonical.id, duplicateIds);
    result.blockingWarningsOrErrors.push(...watchlistValidation.warnings);

    if (watchlistValidation.issues.length > 0) {
      result.status = "blocked";
      result.reason = "Watchlist conflict blocks merge.";
      result.blockingWarningsOrErrors.push(...watchlistValidation.issues);
      result.manualNextSteps.push(
        "Resolve conflicting default watchlists before rerunning merge.",
        "Example SQL: UPDATE watchlists SET is_default = false WHERE id IN (<conflicting_watchlist_ids>) AND id <> <chosen_default_id>;"
      );
      return emitFinalResult(result, 1);
    }

    if (dryRun) {
      result.status = "dry-run";
      result.reason = "Dry-run complete. No rows were modified.";
      return emitFinalResult(result, 0);
    }

    if (!confirmMerge) {
      result.status = "error";
      result.reason = "Refusing write: CONFIRM_MERGE must be true when DRY_RUN=false.";
      return emitFinalResult(result, 1);
    }

    const movedCounts = await db.transaction(async (tx) => moveUserRows(tx as typeof db, canonical.id, duplicateIds));
    result.movedRowsByTable = movedCounts;
    result.transactionCommitted = true;
    result.status = "committed";
    result.reason = "Merge committed.";
    result.manualNextSteps.push("Manual final step required: delete duplicate user rows only after verifying moved data.");
    return emitFinalResult(result, 0);
  } catch (error) {
    result.status = "error";
    result.reason = error instanceof Error ? error.message : String(error);
    result.blockingWarningsOrErrors.push(result.reason);
    return emitFinalResult(result, 1);
  }
}

if (import.meta.main) {
  main();
}
