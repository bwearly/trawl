import { db } from "@/lib/db";
import {
  disclosures,
  politicians,
  politicianStats,
  watchlistItems,
  watchlists,
} from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export type WatchlistPolitician = {
  id: number;
  fullName: string;
  chamber: string;
  party: string | null;
  state: string | null;
  totalDisclosures: number;
  avgAlpha30d: number | null;
  winRate30d: number | null;
  lastTradeDate: Date | null;
};

export type WatchlistTicker = {
  ticker: string;
  assetName: string;
  disclosureCount: number;
  lastTradeDate: Date | null;
};

export async function getOrCreateDefaultWatchlist(userId: string) {
  const existing = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(watchlists)
    .values({
      userId,
      name: "My Watchlist",
      isDefault: true,
      updatedAt: new Date(),
    })
    .returning();

  return inserted[0];
}

export async function addTickerToWatchlist(userId: string, ticker: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const normalizedTicker = ticker.trim().toUpperCase();

  if (!normalizedTicker) {
    throw new Error("Ticker is required");
  }

  await db
    .insert(watchlistItems)
    .values({
      watchlistId: watchlist.id,
      itemType: "ticker",
      ticker: normalizedTicker,
    })
    .onConflictDoNothing();

  return watchlist;
}

export async function addPoliticianToWatchlist(
  userId: string,
  politicianId: number
) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  await db
    .insert(watchlistItems)
    .values({
      watchlistId: watchlist.id,
      itemType: "politician",
      politicianId,
    })
    .onConflictDoNothing();

  return watchlist;
}

export async function removeTickerFromWatchlist(userId: string, ticker: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const normalizedTicker = ticker.trim().toUpperCase();

  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "ticker"),
        eq(watchlistItems.ticker, normalizedTicker)
      )
    );
}

export async function removePoliticianFromWatchlist(
  userId: string,
  politicianId: number
) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "politician"),
        eq(watchlistItems.politicianId, politicianId)
      )
    );
}

export async function isTickerWatched(userId: string, ticker: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);
  const normalizedTicker = ticker.trim().toUpperCase();

  const rows = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "ticker"),
        eq(watchlistItems.ticker, normalizedTicker)
      )
    )
    .limit(1);

  return Boolean(rows[0]);
}

export async function isPoliticianWatched(
  userId: string,
  politicianId: number
) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  const rows = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "politician"),
        eq(watchlistItems.politicianId, politicianId)
      )
    )
    .limit(1);

  return Boolean(rows[0]);
}

export async function getWatchedTickers(userId: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  const rows = await db
    .select({ ticker: watchlistItems.ticker })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "ticker")
      )
    );

  return rows
    .map((row) => row.ticker)
    .filter((ticker): ticker is string => Boolean(ticker));
}

export async function getWatchedPoliticianIds(userId: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  const rows = await db
    .select({ politicianId: watchlistItems.politicianId })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.watchlistId, watchlist.id),
        eq(watchlistItems.itemType, "politician")
      )
    );

  return rows
    .map((row) => row.politicianId)
    .filter((politicianId): politicianId is number =>
      Number.isFinite(politicianId)
    );
}

export async function getWatchlist(userId: string) {
  const watchlist = await getOrCreateDefaultWatchlist(userId);

  const items = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, watchlist.id))
    .orderBy(desc(watchlistItems.createdAt), desc(watchlistItems.id));

  const politicianIds = items
    .filter(
      (item) =>
        item.itemType === "politician" && item.politicianId !== null
    )
    .map((item) => item.politicianId as number);

  const tickerSymbols = items
    .filter((item) => item.itemType === "ticker" && item.ticker)
    .map((item) => item.ticker as string);

  const politicianRows =
    politicianIds.length > 0
      ? await db
          .select({
            id: politicians.id,
            fullName: politicians.fullName,
            chamber: politicians.chamber,
            party: politicians.party,
            state: politicians.state,
            totalDisclosures: politicianStats.totalDisclosures,
            avgAlpha30d: politicianStats.avgAlpha30d,
            winRate30d: politicianStats.winRate30d,
            lastTradeDate: politicianStats.lastTradeDate,
          })
          .from(politicians)
          .leftJoin(
            politicianStats,
            eq(politicianStats.politicianId, politicians.id)
          )
          .where(inArray(politicians.id, politicianIds))
      : [];

  const tickerRows =
    tickerSymbols.length > 0
      ? await db
          .select({
            ticker: disclosures.ticker,
            assetName: sql<string>`min(${disclosures.assetName})`.as(
              "asset_name"
            ),
            disclosureCount: sql<number>`count(*)::int`.as(
              "disclosure_count"
            ),
            lastTradeDate: sql<Date | null>`max(${disclosures.tradeDate})`.as(
              "last_trade_date"
            ),
          })
          .from(disclosures)
          .where(inArray(disclosures.ticker, tickerSymbols))
          .groupBy(disclosures.ticker)
          .orderBy(desc(sql`max(${disclosures.tradeDate})`))
      : [];

  const politicianMap = new Map<number, WatchlistPolitician>(
    politicianRows.map((row) => [
      row.id,
      {
        id: row.id,
        fullName: row.fullName,
        chamber: row.chamber,
        party: row.party,
        state: row.state,
        totalDisclosures: row.totalDisclosures ?? 0,
        avgAlpha30d:
          row.avgAlpha30d === null || row.avgAlpha30d === undefined
            ? null
            : Number(row.avgAlpha30d),
        winRate30d:
          row.winRate30d === null || row.winRate30d === undefined
            ? null
            : Number(row.winRate30d),
        lastTradeDate: row.lastTradeDate,
      },
    ])
  );

  const tickerMap = new Map<string, WatchlistTicker>(
    tickerRows.map((row) => [
      String(row.ticker),
      {
        ticker: String(row.ticker),
        assetName: String(row.assetName ?? ""),
        disclosureCount: Number(row.disclosureCount ?? 0),
        lastTradeDate: row.lastTradeDate ?? null,
      },
    ])
  );

  const politiciansResult: WatchlistPolitician[] = items
    .filter(
      (item) =>
        item.itemType === "politician" && item.politicianId !== null
    )
    .flatMap((item) => {
      const politician = politicianMap.get(item.politicianId as number);
      return politician ? [politician] : [];
    });

  const tickersResult: WatchlistTicker[] = items
    .filter((item) => item.itemType === "ticker" && item.ticker)
    .flatMap((item) => {
      const ticker = tickerMap.get(item.ticker as string);
      return ticker ? [ticker] : [];
    });

  return {
    watchlist,
    politicians: politiciansResult,
    tickers: tickersResult,
  };
}
