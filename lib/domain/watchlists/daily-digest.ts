import { db } from "@/lib/db";
import {
  alertPreferences,
  disclosures,
  politicians,
  researchSignals,
  users,
  watchlistDigestDeliveries,
  watchlistItems,
  watchlists,
} from "@/lib/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { isDigestSignalActionable } from "@/lib/domain/watchlists/digest-eligibility";

const DEFAULT_MIN_SCORE = 60;

export type DigestSignal = {
  researchSignalId: number;
  ticker: string;
  politicianName: string;
  tradeType: string;
  amountRangeLabel: string | null;
  filingLagDays: number | null;
  score: number;
  primaryReason: string | null;
  reasonSummary: string | null;
  signalUrl: string;
};

export type UserDigestBatch = {
  userId: string;
  recipient: string;
  signals: DigestSignal[];
};

export type DigestBuildSummary = {
  usersChecked: number;
  usersWithMatches: number;
  signalsIncluded: number;
  skippedAlreadyDelivered: number;
  skippedBelowThreshold: number;
  skippedNotActionable: number;
  skippedNoWatchlistMatch: number;
  skippedMissingEmail: number;
};


export async function buildWatchlistDailyDigest(options: { windowHours?: number; baseUrl: string }) {
  const windowHours = options.windowHours ?? 24;
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const candidates = await db
    .select({
      researchSignalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      createdAt: researchSignals.createdAt,
      politicianId: researchSignals.politicianId,
      politicianName: politicians.fullName,
      tradeType: disclosures.tradeType,
      filingLagDays: disclosures.filingLagDays,
      amountRangeLabel: disclosures.amountRangeLabel,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(disclosures.id, researchSignals.disclosureId))
    .innerJoin(politicians, eq(politicians.id, researchSignals.politicianId))
    .where(gte(researchSignals.createdAt, cutoff));

  const watchRows = await db
    .select({
      userId: watchlists.userId,
      itemType: watchlistItems.itemType,
      ticker: watchlistItems.ticker,
      politicianId: watchlistItems.politicianId,
      email: users.email,
      minScore: alertPreferences.minScore,
      enableTickers: alertPreferences.enableWatchedTickerAlerts,
      enablePoliticians: alertPreferences.enableWatchedPoliticianAlerts,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
    .leftJoin(users, eq(users.id, watchlists.userId))
    .leftJoin(alertPreferences, eq(alertPreferences.userId, watchlists.userId));

  const userConfig = new Map<string, { email: string | null; minScore: number; tickersEnabled: boolean; politiciansEnabled: boolean; tickers: Set<string>; politicians: Set<number> }>();

  for (const row of watchRows) {
    if (!userConfig.has(row.userId)) {
      userConfig.set(row.userId, {
        email: row.email ?? null,
        minScore: row.minScore == null ? DEFAULT_MIN_SCORE : Number(row.minScore),
        tickersEnabled: row.enableTickers ?? true,
        politiciansEnabled: row.enablePoliticians ?? true,
        tickers: new Set<string>(),
        politicians: new Set<number>(),
      });
    }
    const cfg = userConfig.get(row.userId)!;
    if (row.itemType === "ticker" && row.ticker) cfg.tickers.add(row.ticker.trim().toUpperCase());
    if (row.itemType === "politician" && row.politicianId != null) cfg.politicians.add(row.politicianId);
  }

  const allSignalIds = candidates.map((c) => c.researchSignalId);
  const delivered = allSignalIds.length
    ? await db
        .select({ userId: watchlistDigestDeliveries.userId, researchSignalId: watchlistDigestDeliveries.researchSignalId })
        .from(watchlistDigestDeliveries)
        .where(and(eq(watchlistDigestDeliveries.deliveryType, "daily_digest"), eq(watchlistDigestDeliveries.status, "sent"), inArray(watchlistDigestDeliveries.researchSignalId, allSignalIds)))
    : [];
  const deliveredSet = new Set(delivered.map((d) => `${d.userId}:${d.researchSignalId}`));

  const byUser = new Map<string, UserDigestBatch>();
  const summary: DigestBuildSummary = { usersChecked: userConfig.size, usersWithMatches: 0, signalsIncluded: 0, skippedAlreadyDelivered: 0, skippedBelowThreshold: 0, skippedNotActionable: 0, skippedNoWatchlistMatch: 0, skippedMissingEmail: 0 };

  for (const signal of candidates) {
    const score = Number(signal.score ?? 0);
    const normalizedTicker = signal.ticker.trim().toUpperCase();
    for (const [userId, cfg] of userConfig) {
      const tickerMatch = cfg.tickersEnabled && cfg.tickers.has(normalizedTicker);
      const polMatch = cfg.politiciansEnabled && cfg.politicians.has(signal.politicianId);
      if (!tickerMatch && !polMatch) {
        summary.skippedNoWatchlistMatch += 1;
        continue;
      }
      if (!cfg.email || !cfg.email.includes("@")) {
        summary.skippedMissingEmail += 1;
        continue;
      }
      const actionable = isDigestSignalActionable({ tradeType: signal.tradeType, filingLagDays: signal.filingLagDays, score, minScore: cfg.minScore || DEFAULT_MIN_SCORE });
      if (!actionable.ok) {
        if (actionable.reason === "score") summary.skippedBelowThreshold += 1;
        else summary.skippedNotActionable += 1;
        continue;
      }
      if (deliveredSet.has(`${userId}:${signal.researchSignalId}`)) {
        summary.skippedAlreadyDelivered += 1;
        continue;
      }

      if (!byUser.has(userId)) byUser.set(userId, { userId, recipient: cfg.email, signals: [] });
      byUser.get(userId)!.signals.push({
        researchSignalId: signal.researchSignalId,
        ticker: normalizedTicker,
        politicianName: signal.politicianName,
        tradeType: signal.tradeType,
        amountRangeLabel: signal.amountRangeLabel,
        filingLagDays: signal.filingLagDays,
        score,
        primaryReason: signal.primaryReason,
        reasonSummary: signal.reasonSummary,
        signalUrl: `${options.baseUrl.replace(/\/$/, "")}/signals/${signal.researchSignalId}`,
      });
      summary.signalsIncluded += 1;
    }
  }

  summary.usersWithMatches = byUser.size;
  return { batches: [...byUser.values()], summary, cutoff };
}
