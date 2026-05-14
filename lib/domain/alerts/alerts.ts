import { db } from "@/lib/db";
import {
  alerts,
  disclosures,
  researchSignals,
  watchlistItems,
  watchlists,
} from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getOrCreateAlertPreferences } from "@/lib/domain/alerts/preferences";
import { shouldGenerateAlert } from "@/lib/domain/alerts/should-generate-alert";
import { enqueueEmailNotificationJob } from "@/lib/domain/notifications/enqueue-notification";

export type AlertRow = {
  id: number;
  userId: string;
  type: string;
  ticker: string | null;
  politicianId: number | null;
  disclosureId: number | null;
  researchSignalId: number | null;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: Date;
};

const DEMO_USER_ID = "demo-user";

export async function getAlerts(userId: string) {
  return db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.createdAt), desc(alerts.id));
}

export async function getUnreadAlertsCount(userId: string) {
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)));

  return rows[0]?.count ?? 0;
}

export async function markAlertAsRead(userId: string, alertId: number) {
  await db
    .update(alerts)
    .set({ isRead: true })
    .where(and(eq(alerts.userId, userId), eq(alerts.id, alertId)));
}

export async function markAllAlertsAsRead(userId: string) {
  await db
    .update(alerts)
    .set({ isRead: true })
    .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)));
}

type GenerateAlertsOptions = {
  confidencePenalty?: number | null;
};

export async function generateAlertsForSignal(
  researchSignalId: number,
  options: GenerateAlertsOptions = {}
) {
  const signalRows = await db
    .select({
      id: researchSignals.id,
      disclosureId: researchSignals.disclosureId,
      politicianId: researchSignals.politicianId,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      primaryReason: researchSignals.primaryReason,
      signalDate: researchSignals.signalDate,
      tradeType: disclosures.tradeType,
      filingLagDays: disclosures.filingLagDays,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(disclosures.id, researchSignals.disclosureId))
    .where(eq(researchSignals.id, researchSignalId))
    .limit(1);

  const signal = signalRows[0];

  if (!signal) {
    throw new Error(`Signal ${researchSignalId} not found`);
  }

  const normalizedTicker = signal.ticker.trim().toUpperCase();
  const signalScore =
    signal.score === null || signal.score === undefined
      ? 0
      : Number(signal.score);
  const eligibility = shouldGenerateAlert({
    signalStatus: signal.signalStatus,
    tradeType: signal.tradeType,
    adjustedScore: signalScore,
    confidencePenalty: options.confidencePenalty ?? null,
    filingLagDays: signal.filingLagDays,
  });

  if (!eligibility.shouldAlert) {
    return {
      tickerAlertsCreated: 0,
      politicianAlertsCreated: 0,
      skipped: true,
      tier: eligibility.tier,
      blockedBy: eligibility.blockedBy,
    };
  }

  const watchedTickerRows = await db
    .select({
      userId: watchlists.userId,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
    .where(
      and(
        eq(watchlistItems.itemType, "ticker"),
        eq(watchlistItems.ticker, normalizedTicker)
      )
    );

  const watchedPoliticianRows = await db
    .select({
      userId: watchlists.userId,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
    .where(
      and(
        eq(watchlistItems.itemType, "politician"),
        eq(watchlistItems.politicianId, signal.politicianId)
      )
    );

  const tickerUserIds = [...new Set(watchedTickerRows.map((row) => row.userId))];
  const politicianUserIds = [
    ...new Set(watchedPoliticianRows.map((row) => row.userId)),
  ];

  const eligibleTickerUserIds: string[] = [];
  for (const userId of tickerUserIds) {
    const prefs = await getOrCreateAlertPreferences(userId);
    if (prefs.enableWatchedTickerAlerts && signalScore >= prefs.minScore) {
      eligibleTickerUserIds.push(userId);
    }
  }

  const eligiblePoliticianUserIds: string[] = [];
  for (const userId of politicianUserIds) {
    const prefs = await getOrCreateAlertPreferences(userId);
    if (prefs.enableWatchedPoliticianAlerts && signalScore >= prefs.minScore) {
      eligiblePoliticianUserIds.push(userId);
    }
  }

  if (eligibleTickerUserIds.length > 0) {
    const insertedTickerAlerts = await db
      .insert(alerts)
      .values(
        eligibleTickerUserIds.map((userId) => ({
          userId,
          type: "watched_ticker_signal",
          ticker: normalizedTicker,
          politicianId: signal.politicianId,
          disclosureId: signal.disclosureId,
          researchSignalId: signal.id,
          title: `New watched ticker signal: ${normalizedTicker}`,
          message: signal.primaryReason
            ? `${normalizedTicker} triggered a new signal. ${signal.primaryReason}`
            : `${normalizedTicker} triggered a new signal.`,
          isRead: false,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: alerts.id, userId: alerts.userId });

    if (process.env.ALERT_EMAIL_QUEUE_ENABLED === "true") {
      for (const alertRow of insertedTickerAlerts) {
        try {
          await enqueueEmailNotificationJob({
            alertId: alertRow.id,
            userId: alertRow.userId,
            recipient: null,
            idempotencyKey: `alert:${alertRow.id}:email`,
          });
        } catch (error) {
          console.error("Failed to enqueue ticker alert email notification", {
            alertId: alertRow.id,
            userId: alertRow.userId,
            error,
          });
        }
      }
    }
  }

  if (eligiblePoliticianUserIds.length > 0) {
    const insertedPoliticianAlerts = await db
      .insert(alerts)
      .values(
        eligiblePoliticianUserIds.map((userId) => ({
          userId,
          type: "watched_politician_signal",
          ticker: normalizedTicker,
          politicianId: signal.politicianId,
          disclosureId: signal.disclosureId,
          researchSignalId: signal.id,
          title: `New watched politician signal`,
          message: signal.primaryReason
            ? `A watched politician triggered a new ${normalizedTicker} signal. ${signal.primaryReason}`
            : `A watched politician triggered a new ${normalizedTicker} signal.`,
          isRead: false,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: alerts.id, userId: alerts.userId });

    if (process.env.ALERT_EMAIL_QUEUE_ENABLED === "true") {
      for (const alertRow of insertedPoliticianAlerts) {
        try {
          await enqueueEmailNotificationJob({
            alertId: alertRow.id,
            userId: alertRow.userId,
            recipient: null,
            idempotencyKey: `alert:${alertRow.id}:email`,
          });
        } catch (error) {
          console.error("Failed to enqueue politician alert email notification", {
            alertId: alertRow.id,
            userId: alertRow.userId,
            error,
          });
        }
      }
    }
  }

  return {
    tickerAlertsCreated: eligibleTickerUserIds.length,
    politicianAlertsCreated: eligiblePoliticianUserIds.length,
    skipped: false,
    tier: eligibility.tier,
    blockedBy: eligibility.blockedBy,
  };
}

/**
 * Backfill historical alerts for a specific user based on that user's
 * current watchlist items.
 */
export async function backfillAlertsForUser(userId: string) {
  const watchlistRows = await db
    .select({
      id: watchlists.id,
    })
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .limit(1);

  const watchlist = watchlistRows[0];
  if (!watchlist) {
    return { processedSignals: 0 };
  }

  const watchItems = await db
    .select({
      itemType: watchlistItems.itemType,
      ticker: watchlistItems.ticker,
      politicianId: watchlistItems.politicianId,
    })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, watchlist.id));

  const watchedTickers = watchItems
    .filter((item) => item.itemType === "ticker" && item.ticker)
    .map((item) => item.ticker as string);

  const watchedPoliticianIds = watchItems
    .filter(
      (item) => item.itemType === "politician" && item.politicianId !== null
    )
    .map((item) => item.politicianId as number);

  if (watchedTickers.length === 0 && watchedPoliticianIds.length === 0) {
    return { processedSignals: 0 };
  }

  const signalRows = await db
    .select({
      id: researchSignals.id,
      ticker: researchSignals.ticker,
      politicianId: researchSignals.politicianId,
    })
    .from(researchSignals)
    .where(
      watchedTickers.length > 0 && watchedPoliticianIds.length > 0
        ? sql`upper(${researchSignals.ticker}) in (${sql.join(
            watchedTickers.map((ticker) => sql`${ticker.toUpperCase()}`),
            sql`, `
          )}) or ${researchSignals.politicianId} in (${sql.join(
            watchedPoliticianIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        : watchedTickers.length > 0
        ? sql`upper(${researchSignals.ticker}) in (${sql.join(
            watchedTickers.map((ticker) => sql`${ticker.toUpperCase()}`),
            sql`, `
          )})`
        : inArray(researchSignals.politicianId, watchedPoliticianIds)
    )
    .orderBy(desc(researchSignals.signalDate), desc(researchSignals.id));

  for (const row of signalRows) {
    await generateAlertsForSignal(row.id);
  }

  return { processedSignals: signalRows.length };
}

/**
 * Demo-only compatibility helper used by existing scripts.
 */
export async function backfillAlertsForDemoUser() {
  return backfillAlertsForUser(DEMO_USER_ID);
}
