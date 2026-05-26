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
  return {
    targetEmail: normalizeEmail(process.env.TARGET_EMAIL),
    canonicalUserId: process.env.CANONICAL_USER_ID?.trim() || null,
    dryRun: parseBoolEnv(process.env.DRY_RUN, true),
    confirmMerge: parseBoolEnv(process.env.CONFIRM_MERGE, false),
    debugMode: parseBoolEnv(process.env.MERGE_DEBUG, false),
  };
}

function debugLog(enabled: boolean, message: string, extra?: Record<string, unknown>) {
  if (!enabled) return;
  const payload = extra ? { message, ...extra } : { message };
  console.log(`[merge-duplicate-users][debug] ${JSON.stringify(payload)}`);
}

export function buildDuplicateUserCondition<TColumn>(column: TColumn, duplicateIds: string[]) {
  return inArray(column as never, duplicateIds);
}

async function countPlannedMoves(duplicateIds: string[]): Promise<MoveCounts> {
  const byTable: MoveCounts = {};

  const [watchlistsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlists)
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds));
  byTable.watchlists = Number(watchlistsCount?.count ?? 0);

  const [itemsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds));
  byTable.watchlistItems = Number(itemsCount?.count ?? 0);

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

  return byTable;
}

async function validateWatchlistMove(canonicalUserId: string, duplicateIds: string[]) {
  const issues: string[] = [];
  const warnings: string[] = [];

  const canonicalDefault = await db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(and(eq(watchlists.userId, canonicalUserId), eq(watchlists.isDefault, true)));

  if (canonicalDefault.length > 1) {
    issues.push(`Canonical user has multiple default watchlists: ${canonicalDefault.map((r) => r.id).join(", ")}`);
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

  if (canonicalDefault.length > 0 && duplicateDefaultRows.length > 0) {
    warnings.push(
      `Canonical user already has a default watchlist and ${duplicateDefaultRows.length} duplicate default watchlist(s) will also be moved.`
    );
  }

  return { issues, warnings };
}

async function moveUserRows(tx: typeof db, canonicalUserId: string, duplicateIds: string[]) {
  const movedCounts: MoveCounts = {
    watchlists: 0,
    watchlistItems: 0,
    alerts: 0,
    notificationJobs: 0,
    notificationEvents: 0,
    watchlistDigestDeliveries: 0,
    alertPreferences: 0,
  };

  const movedWatchlists = await tx
    .update(watchlists)
    .set({ userId: canonicalUserId })
    .where(buildDuplicateUserCondition(watchlists.userId, duplicateIds))
    .returning({ id: watchlists.id });
  movedCounts.watchlists = movedWatchlists.length;

  // moved implicitly by watchlists.userId update
  const [movedWatchlistItems] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .where(eq(watchlists.userId, canonicalUserId));
  movedCounts.watchlistItems = Number(movedWatchlistItems?.count ?? 0);

  const movedAlerts = await tx
    .update(alerts)
    .set({ userId: canonicalUserId })
    .where(buildDuplicateUserCondition(alerts.userId, duplicateIds))
    .returning({ id: alerts.id });
  movedCounts.alerts = movedAlerts.length;

  const movedNotificationJobs = await tx
    .update(notificationJobs)
    .set({ userId: canonicalUserId })
    .where(buildDuplicateUserCondition(notificationJobs.userId, duplicateIds))
    .returning({ id: notificationJobs.id });
  movedCounts.notificationJobs = movedNotificationJobs.length;

  const movedNotificationEvents = await tx
    .update(notificationEvents)
    .set({ userId: canonicalUserId })
    .where(buildDuplicateUserCondition(notificationEvents.userId, duplicateIds))
    .returning({ id: notificationEvents.id });
  movedCounts.notificationEvents = movedNotificationEvents.length;

  const movedDigests = await tx
    .update(watchlistDigestDeliveries)
    .set({ userId: canonicalUserId })
    .where(
      and(
        buildDuplicateUserCondition(watchlistDigestDeliveries.userId, duplicateIds),
        sql`NOT EXISTS (
          SELECT 1
          FROM watchlist_digest_deliveries wd2
          WHERE wd2.user_id = ${canonicalUserId}
            AND wd2.research_signal_id = ${watchlistDigestDeliveries.researchSignalId}
            AND wd2.delivery_type = ${watchlistDigestDeliveries.deliveryType}
        )`
      )
    )
    .returning({ id: watchlistDigestDeliveries.id });
  movedCounts.watchlistDigestDeliveries = movedDigests.length;

  const [canonicalPrefsCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(alertPreferences)
    .where(eq(alertPreferences.userId, canonicalUserId));

  if (Number(canonicalPrefsCount?.count ?? 0) === 0) {
    const movedPrefs = await tx
      .update(alertPreferences)
      .set({ userId: canonicalUserId })
      .where(buildDuplicateUserCondition(alertPreferences.userId, duplicateIds))
      .returning({ id: alertPreferences.id });
    movedCounts.alertPreferences = movedPrefs.length;
  }

  return movedCounts;
}

function emitFinalResult(result: MergeResult, exitCode: number) {
  console.log(JSON.stringify(result, null, 2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
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
    const { targetEmail, canonicalUserId, dryRun, confirmMerge, debugMode } = getConfig();
    debugLog(debugMode, "script started");

    result.targetEmail = targetEmail;
    result.canonicalUserIdInput = canonicalUserId;
    result.dryRun = dryRun;
    result.confirmMerge = confirmMerge;

    debugLog(debugMode, "parsed env", { targetEmail, canonicalUserId, dryRun, confirmMerge });

    if (!targetEmail || !canonicalUserId) {
      throw new Error("Missing required input: TARGET_EMAIL and CANONICAL_USER_ID must both be set.");
    }

    const targetUsers = await db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${targetEmail}`)
      .orderBy(asc(users.createdAt));

    debugLog(debugMode, "resolved target email", { matches: targetUsers.map((u) => u.id) });

    if (targetUsers.length === 0) {
      result.status = "error";
      result.reason = `No users found for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 1);
    }

    const canonical = targetUsers.find((u) => u.id === canonicalUserId);
    debugLog(debugMode, "resolved canonical", { canonicalUserId, found: Boolean(canonical) });

    if (!canonical) {
      result.status = "error";
      result.reason = `CANONICAL_USER_ID=${canonicalUserId} is not among users for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 1);
    }

    const duplicateIds = targetUsers.filter((u) => u.id !== canonical.id).map((u) => u.id);
    result.canonicalUserIdResolved = canonical.id;
    result.duplicateUserIds = duplicateIds;

    debugLog(debugMode, "duplicate IDs found", { duplicateIds });

    if (duplicateIds.length === 0) {
      result.status = "no-op";
      result.reason = `No duplicate users found for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 0);
    }

    result.plannedRowMovesByTable = await countPlannedMoves(duplicateIds);

    const watchlistValidation = await validateWatchlistMove(canonical.id, duplicateIds);
    result.blockingWarningsOrErrors.push(...watchlistValidation.warnings);
    debugLog(debugMode, "blockers found", {
      warnings: watchlistValidation.warnings,
      issues: watchlistValidation.issues,
    });

    if (watchlistValidation.issues.length > 0) {
      result.status = "blocked";
      result.reason = "Watchlist conflict blocks merge.";
      result.blockingWarningsOrErrors.push(...watchlistValidation.issues);
      result.manualNextSteps.push("Run npm run watchlists:audit-duplicates to identify duplicate default watchlists.");
      result.manualNextSteps.push("Run npm run watchlists:consolidate-defaults with TARGET_USER_ID or TARGET_EMAIL for each blocked user.");
      return emitFinalResult(result, 1);
    }

    debugLog(debugMode, "dry-run/confirmed path selected", { dryRun, confirmMerge });

    if (dryRun) {
      result.status = "dry-run";
      result.reason = "Dry-run complete. No rows were modified.";
      debugLog(debugMode, "final result printed", { status: result.status });
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
    result.reason = "Merge committed. Duplicate user rows were not deleted.";
    result.skippedOrConflictingRows.push(
      "alert_preferences rows for duplicates were skipped when canonical alert preferences already existed.",
      "watchlist_digest_deliveries rows were skipped when canonical already had the same (research_signal_id, delivery_type)."
    );
    result.manualNextSteps.push("Manual final step required: delete duplicate user rows only after verifying moved data.");
    debugLog(debugMode, "final result printed", { status: result.status });
    return emitFinalResult(result, 0);
  } catch (error) {
    result.status = "error";
    result.reason = error instanceof Error ? error.message : String(error);
    result.blockingWarningsOrErrors.push(result.reason);
    return emitFinalResult(result, 1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        reason: "merge-duplicate-users failed",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
