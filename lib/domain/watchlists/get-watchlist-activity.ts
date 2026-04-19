import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { getSignalAlertTier } from "@/lib/domain/alerts/get-signal-alert-tier";
import { clusterSignals, type Signal } from "@/lib/domain/signals/clusterSignals";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";
import { getWatchedPoliticianIds, getWatchedTickers } from "@/lib/domain/watchlists/watchlists";

const RECENT_ACTIVITY_DAYS = 21;
const MAX_ACTIVITY_ITEMS = 16;

type ActivityType =
  | "ticker_new_signal"
  | "politician_new_signal"
  | "ticker_cluster_activity"
  | "politician_cluster_activity"
  | "alert_eligible"
  | "high_conviction";

export type WatchlistActivityItem = {
  type: ActivityType;
  entityType: "ticker" | "politician";
  entityId: string | number;
  entityLabel: string;
  signalId?: number;
  ticker?: string;
  politicianId?: number;
  politicianName?: string;
  score?: number;
  alertTier?: string | null;
  createdAt: Date;
  headline: string;
  subheadline: string;
};

type ActivitySignalRow = {
  signalId: number;
  ticker: string;
  politicianId: number;
  politicianName: string;
  signalDate: Date;
  tradeDate: Date | null;
  filingDate: Date | null;
  tradeType: string;
  signalStatus: string;
  filingLagDays: number | null;
  score: string;
};

type ClusterActivitySignal = Signal & {
  signalId: number;
  politicianId: number;
  politicianName: string;
};

function pluralizeTrades(count: number) {
  return `${count} trade${count === 1 ? "" : "s"}`;
}

function toRecentDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function getSignalScore(score: string): number {
  const value = Number(score);
  return Number.isFinite(value) ? value : 0;
}

function createActivityKey(item: WatchlistActivityItem): string {
  return `${item.type}::${item.entityType}::${item.entityId}::${item.signalId ?? "none"}`;
}

function getActivityTradeDate(row: ActivitySignalRow): Date {
  return row.tradeDate ?? row.filingDate ?? row.signalDate;
}

function toClusterSignal(row: ActivitySignalRow): ClusterActivitySignal {
  return {
    signalId: row.signalId,
    ticker: row.ticker,
    politician: row.politicianName,
    politicianId: row.politicianId,
    politicianName: row.politicianName,
    tradeType: row.tradeType,
    tradeDate: getActivityTradeDate(row),
    score: getSignalScore(row.score),
  };
}

function buildSignalActivities(
  row: ActivitySignalRow,
  watchedTickers: Set<string>,
  watchedPoliticianIds: Set<number>
): WatchlistActivityItem[] {
  const activities: WatchlistActivityItem[] = [];
  const score = getSignalScore(row.score);
  const createdAt = row.signalDate;
  const alertTier = getSignalAlertTier({
    score,
    signalStatus: row.signalStatus,
    tradeType: row.tradeType,
    filingLagDays: row.filingLagDays,
  });

  if (watchedTickers.has(row.ticker)) {
    activities.push({
      type: "ticker_new_signal",
      entityType: "ticker",
      entityId: row.ticker,
      entityLabel: row.ticker,
      signalId: row.signalId,
      ticker: row.ticker,
      politicianId: row.politicianId,
      politicianName: row.politicianName,
      score,
      alertTier,
      createdAt,
      headline: `New signal for watched ticker ${row.ticker}`,
      subheadline: `${row.politicianName} · Score ${Math.round(score)}${alertTier ? ` · ${alertTier.replace("_", " ")}` : ""}`,
    });
  }

  if (watchedPoliticianIds.has(row.politicianId)) {
    activities.push({
      type: "politician_new_signal",
      entityType: "politician",
      entityId: row.politicianId,
      entityLabel: row.politicianName,
      signalId: row.signalId,
      ticker: row.ticker,
      politicianId: row.politicianId,
      politicianName: row.politicianName,
      score,
      alertTier,
      createdAt,
      headline: `${row.politicianName} filed again in ${row.ticker}`,
      subheadline: `Score ${Math.round(score)}${alertTier ? ` · Alert ${alertTier.replace("_", " ")}` : ""}`,
    });
  }

  if (alertTier && watchedTickers.has(row.ticker)) {
    activities.push({
      type: "alert_eligible",
      entityType: "ticker",
      entityId: row.ticker,
      entityLabel: row.ticker,
      signalId: row.signalId,
      ticker: row.ticker,
      politicianId: row.politicianId,
      politicianName: row.politicianName,
      score,
      alertTier,
      createdAt,
      headline: `Watched ticker ${row.ticker} has an alert-eligible signal`,
      subheadline: `${row.politicianName} · Tier ${alertTier.replace("_", " ")} · Score ${Math.round(score)}`,
    });
  }

  if (alertTier === "high_conviction" && watchedTickers.has(row.ticker)) {
    activities.push({
      type: "high_conviction",
      entityType: "ticker",
      entityId: row.ticker,
      entityLabel: row.ticker,
      signalId: row.signalId,
      ticker: row.ticker,
      politicianId: row.politicianId,
      politicianName: row.politicianName,
      score,
      alertTier,
      createdAt,
      headline: `Watched ticker ${row.ticker} now has a high-conviction signal`,
      subheadline: `${row.politicianName} · Score ${Math.round(score)} · Tier high conviction`,
    });
  }

  return activities;
}

function buildClusterActivities(
  rows: ActivitySignalRow[],
  watchedTickers: Set<string>,
  watchedPoliticianIds: Set<number>
): WatchlistActivityItem[] {
  const clusters = clusterSignals(rows.map(toClusterSignal));
  const activities: WatchlistActivityItem[] = [];

  for (const cluster of clusters) {
    if (cluster.count < 2) {
      continue;
    }

    const latestSignal = cluster.signals[cluster.signals.length - 1];
    const roundedLatestScore = Math.round(cluster.latestScore);
    const sharedSubheadline = `${pluralizeTrades(cluster.count)} over ${Math.max(
      0,
      Math.round((cluster.lastTradeDate.getTime() - cluster.firstTradeDate.getTime()) / (24 * 60 * 60 * 1000))
    )} days · Latest score ${roundedLatestScore}`;

    if (watchedTickers.has(cluster.ticker)) {
      activities.push({
        type: "ticker_cluster_activity",
        entityType: "ticker",
        entityId: cluster.ticker,
        entityLabel: cluster.ticker,
        signalId: latestSignal.signalId,
        ticker: cluster.ticker,
        politicianId: latestSignal.politicianId,
        politicianName: latestSignal.politicianName,
        score: cluster.latestScore,
        createdAt: cluster.lastTradeDate,
        headline: `Clustered activity detected for watched ticker ${cluster.ticker}`,
        subheadline: `${cluster.politician} · ${sharedSubheadline}`,
      });
    }

    if (watchedPoliticianIds.has(latestSignal.politicianId)) {
      activities.push({
        type: "politician_cluster_activity",
        entityType: "politician",
        entityId: latestSignal.politicianId,
        entityLabel: cluster.politician,
        signalId: latestSignal.signalId,
        ticker: cluster.ticker,
        politicianId: latestSignal.politicianId,
        politicianName: cluster.politician,
        score: cluster.latestScore,
        createdAt: cluster.lastTradeDate,
        headline: `Clustered activity detected for watched politician ${cluster.politician}`,
        subheadline: `${cluster.ticker} · ${sharedSubheadline}`,
      });
    }
  }

  return activities;
}

export async function getWatchlistActivity(userId: string): Promise<WatchlistActivityItem[]> {
  const [watchedTickers, watchedPoliticianIds] = await Promise.all([
    getWatchedTickers(userId),
    getWatchedPoliticianIds(userId),
  ]);

  if (watchedTickers.length === 0 && watchedPoliticianIds.length === 0) {
    return [];
  }

  const recentCutoff = toRecentDate(RECENT_ACTIVITY_DAYS);
  const whereClauses = [gte(researchSignals.signalDate, recentCutoff)];

  if (watchedTickers.length > 0 && watchedPoliticianIds.length > 0) {
    whereClauses.push(
      or(
        inArray(researchSignals.ticker, watchedTickers),
        inArray(researchSignals.politicianId, watchedPoliticianIds)
      )
    );
  } else if (watchedTickers.length > 0) {
    whereClauses.push(inArray(researchSignals.ticker, watchedTickers));
  } else if (watchedPoliticianIds.length > 0) {
    whereClauses.push(inArray(researchSignals.politicianId, watchedPoliticianIds));
  }

  const rows = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      politicianId: researchSignals.politicianId,
      politicianName: politicians.fullName,
      signalDate: researchSignals.signalDate,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      tradeType: disclosures.tradeType,
      signalStatus: researchSignals.signalStatus,
      filingLagDays: disclosures.filingLagDays,
      score: researchSignals.score,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .where(and(...whereClauses))
    .orderBy(desc(researchSignals.signalDate))
    .limit(120);

  const watchedTickerSet = new Set<string>(watchedTickers);
  const watchedPoliticianSet = new Set<number>(watchedPoliticianIds);

  const items = [
    ...rows.flatMap((row: ActivitySignalRow) =>
      buildSignalActivities(row, watchedTickerSet, watchedPoliticianSet)
    ),
    ...buildClusterActivities(rows, watchedTickerSet, watchedPoliticianSet),
  ];

  const deduped = new Map<string, WatchlistActivityItem>();

  for (const item of items) {
    deduped.set(createActivityKey(item), item);
  }

  return [...deduped.values()]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, MAX_ACTIVITY_ITEMS);
}
