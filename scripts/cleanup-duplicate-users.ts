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

type CleanupStatus = "dry-run" | "deactivated" | "deleted" | "blocked" | "error" | "no-op";

type DependentCounts = {
  watchlists: number;
  watchlistItems: number;
  alerts: number;
  notificationJobs: number;
  notificationEvents: number;
  watchlistDigestDeliveries: number;
  alertPreferences: number;
};

type DuplicateAudit = {
  userId: string;
  dependentCounts: DependentCounts;
  hasBlockingDependencies: boolean;
};

type CleanupResult = {
  status: CleanupStatus;
  reason: string;
  dryRun: boolean;
  confirmDelete: boolean;
  targetEmail: string | null;
  canonicalUserIdInput: string | null;
  canonicalUserIdResolved: string | null;
  duplicateUserIds: string[];
  duplicateAudits: DuplicateAudit[];
  canonicalAlertPreferencesCount: number;
  plannedAction: "none" | "deactivate" | "delete";
  blockedBy: string[];
  actionsTaken: string[];
  manualNextSteps: string[];
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
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
    confirmDelete: parseBoolEnv(process.env.CONFIRM_DELETE, false),
  };
}

function duplicateCondition<TColumn>(column: TColumn, duplicateIds: string[]) {
  return inArray(column as never, duplicateIds);
}

async function countDependenciesForDuplicate(userId: string): Promise<DependentCounts> {
  const [watchlistsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlists)
    .where(eq(watchlists.userId, userId));

  const [watchlistItemsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .where(eq(watchlists.userId, userId));

  const perUserTables = [
    { key: "alerts", table: alerts, column: alerts.userId },
    { key: "notificationJobs", table: notificationJobs, column: notificationJobs.userId },
    { key: "notificationEvents", table: notificationEvents, column: notificationEvents.userId },
    { key: "watchlistDigestDeliveries", table: watchlistDigestDeliveries, column: watchlistDigestDeliveries.userId },
    { key: "alertPreferences", table: alertPreferences, column: alertPreferences.userId },
  ] as const;

  const dependentCounts: DependentCounts = {
    watchlists: Number(watchlistsCount?.count ?? 0),
    watchlistItems: Number(watchlistItemsCount?.count ?? 0),
    alerts: 0,
    notificationJobs: 0,
    notificationEvents: 0,
    watchlistDigestDeliveries: 0,
    alertPreferences: 0,
  };

  for (const entry of perUserTables) {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entry.table)
      .where(eq(entry.column, userId));
    dependentCounts[entry.key] = Number(countRow?.count ?? 0);
  }

  return dependentCounts;
}

function hasBlockingDependencies(counts: DependentCounts) {
  return Object.values(counts).some((value) => value > 0);
}

function emitFinalResult(result: CleanupResult, exitCode: number) {
  console.log(JSON.stringify(result, null, 2));
  if (exitCode !== 0) process.exitCode = exitCode;
}

export async function main() {
  const result: CleanupResult = {
    status: "no-op",
    reason: "Initialized",
    dryRun: true,
    confirmDelete: false,
    targetEmail: null,
    canonicalUserIdInput: null,
    canonicalUserIdResolved: null,
    duplicateUserIds: [],
    duplicateAudits: [],
    canonicalAlertPreferencesCount: 0,
    plannedAction: "none",
    blockedBy: [],
    actionsTaken: [],
    manualNextSteps: [],
  };

  try {
    const { targetEmail, canonicalUserId, dryRun, confirmDelete } = getConfig();
    result.targetEmail = targetEmail;
    result.canonicalUserIdInput = canonicalUserId;
    result.dryRun = dryRun;
    result.confirmDelete = confirmDelete;

    if (!targetEmail || !canonicalUserId) {
      throw new Error("Missing required input: TARGET_EMAIL and CANONICAL_USER_ID must both be set.");
    }

    const targetUsers = await db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${targetEmail}`)
      .orderBy(asc(users.createdAt));

    if (targetUsers.length === 0) {
      result.status = "error";
      result.reason = `No users found for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 1);
    }

    const canonical = targetUsers.find((u) => u.id === canonicalUserId);
    if (!canonical) {
      result.status = "error";
      result.reason = `CANONICAL_USER_ID=${canonicalUserId} is not among users for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 1);
    }

    const duplicateUserIds = targetUsers.filter((u) => u.id !== canonical.id).map((u) => u.id);
    result.canonicalUserIdResolved = canonical.id;
    result.duplicateUserIds = duplicateUserIds;

    if (duplicateUserIds.length === 0) {
      result.status = "no-op";
      result.reason = `No duplicate users found for TARGET_EMAIL=${targetEmail}.`;
      return emitFinalResult(result, 0);
    }

    const [canonicalPrefs] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertPreferences)
      .where(eq(alertPreferences.userId, canonical.id));
    result.canonicalAlertPreferencesCount = Number(canonicalPrefs?.count ?? 0);

    for (const duplicateUserId of duplicateUserIds) {
      const counts = await countDependenciesForDuplicate(duplicateUserId);
      const audit: DuplicateAudit = {
        userId: duplicateUserId,
        dependentCounts: counts,
        hasBlockingDependencies: hasBlockingDependencies(counts),
      };
      result.duplicateAudits.push(audit);
    }

    const blockedDuplicates = result.duplicateAudits.filter((audit) => audit.hasBlockingDependencies);
    if (blockedDuplicates.length > 0) {
      result.status = "blocked";
      result.reason = "Cleanup blocked: one or more duplicate users still have dependent rows.";
      result.blockedBy.push(
        ...blockedDuplicates.map((audit) => `${audit.userId} has dependent records: ${JSON.stringify(audit.dependentCounts)}`)
      );

      const duplicatePrefs = blockedDuplicates.filter((a) => a.dependentCounts.alertPreferences > 0);
      if (duplicatePrefs.length > 0 && result.canonicalAlertPreferencesCount === 0) {
        result.manualNextSteps.push(
          "Canonical user lacks alert_preferences while duplicates still have them; manually copy or create canonical preferences before cleanup."
        );
      }

      return emitFinalResult(result, 1);
    }

    if (dryRun) {
      result.status = "dry-run";
      result.reason = "Dry-run complete. Duplicates are dependency-free and eligible for cleanup.";
      result.plannedAction = confirmDelete ? "delete" : "deactivate";
      if (!confirmDelete) {
        result.manualNextSteps.push(
          "To hard-delete duplicates after review, rerun with DRY_RUN=false CONFIRM_DELETE=true."
        );
      }
      return emitFinalResult(result, 0);
    }

    if (confirmDelete) {
      const deleted = await db
        .delete(users)
        .where(duplicateCondition(users.id, duplicateUserIds))
        .returning({ id: users.id });
      result.status = "deleted";
      result.reason = "Duplicate users deleted after dependency audit passed.";
      result.plannedAction = "delete";
      result.actionsTaken.push(`Deleted ${deleted.length} duplicate user row(s).`);
      return emitFinalResult(result, 0);
    }

    await db
      .update(users)
      .set({
        email: sql`concat('deactivated+', ${users.id}, '@invalid.local')`,
        name: sql`coalesce(${users.name}, 'Deactivated User')`,
        image: null,
        updatedAt: sql`now()`,
      })
      .where(duplicateCondition(users.id, duplicateUserIds));

    result.status = "deactivated";
    result.reason = "Duplicate users deactivated/anonymized. No hard deletion was performed.";
    result.plannedAction = "deactivate";
    result.actionsTaken.push(
      "Anonymized duplicate users by replacing email with deactivated+<id>@invalid.local and clearing image."
    );
    result.manualNextSteps.push("Validate user-level auth behavior for deactivated rows before adding unique email index.");
    return emitFinalResult(result, 0);
  } catch (error) {
    result.status = "error";
    result.reason = error instanceof Error ? error.message : String(error);
    result.blockedBy.push(result.reason);
    return emitFinalResult(result, 1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        reason: "cleanup-duplicate-users failed",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
