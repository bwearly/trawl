import { config } from "dotenv";
config({ path: ".env.local" });

import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  priceHistory,
} from "../lib/db/schema";
import {
  addCalendarDays,
  calcReturnPercent,
  startOfUtcDay,
} from "../lib/domain/pipeline/performance";

type BackfillOptions = {
  recentDays: number | null;
  missingOnly: boolean;
};

type PriceRow = typeof priceHistory.$inferSelect;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 400;
let retryCount = 0;

const closestPriceCache = new Map<string, PriceRow | null>();
const latestPriceCache = new Map<string, PriceRow | null>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(fetch failed|connection|timeout|NeonDbError|DrizzleQueryError)/i.test(message);
}

async function withRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await task();
    } catch (error) {
      attempt += 1;
      if (!isTransientDbError(error) || attempt > MAX_RETRIES) {
        throw error;
      }

      retryCount += 1;
      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${MAX_RETRIES} failed (${message.slice(0, 180)}). Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }
}

function parseOptions(): BackfillOptions {
  let recentDays: number | null = null;
  let missingOnly = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--recent-days=")) {
      const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --recent-days value: ${arg}`);
      }
      recentDays = value;
    } else if (arg === "--missing-only") {
      missingOnly = true;
    }
  }

  return { recentDays, missingOnly };
}

function isWithinRecentWindow(disclosure: typeof disclosures.$inferSelect, recentDays: number, now: Date) {
  const threshold = startOfUtcDay(addCalendarDays(now, -recentDays));
  const filing = disclosure.filingDate ? startOfUtcDay(disclosure.filingDate) : null;
  const trade = disclosure.tradeDate ? startOfUtcDay(disclosure.tradeDate) : null;
  return (filing != null && filing >= threshold) || (trade != null && trade >= threshold);
}

async function getClosestPriceOnOrAfter(
  ticker: string,
  targetDate: Date
): Promise<PriceRow | null> {
  const normalizedTarget = startOfUtcDay(targetDate);
  const cacheKey = `${ticker}|${normalizedTarget.toISOString()}`;

  if (closestPriceCache.has(cacheKey)) {
    return closestPriceCache.get(cacheKey) ?? null;
  }

  const rows = await withRetry(`getClosestPriceOnOrAfter(${ticker}, ${normalizedTarget.toISOString()})`, async () =>
    db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.ticker, ticker),
          gte(priceHistory.date, normalizedTarget)
        )
      )
      .orderBy(asc(priceHistory.date))
      .limit(1)
  );

  const row = rows[0] ?? null;
  closestPriceCache.set(cacheKey, row);
  return row;
}

async function getLatestPrice(ticker: string): Promise<PriceRow | null> {
  if (latestPriceCache.has(ticker)) {
    return latestPriceCache.get(ticker) ?? null;
  }

  const rows = await withRetry(`getLatestPrice(${ticker})`, async () =>
    db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.ticker, ticker))
      .orderBy(desc(priceHistory.date))
      .limit(1)
  );

  const row = rows[0] ?? null;
  latestPriceCache.set(ticker, row);
  return row;
}

async function resolveFuturePrice(
  ticker: string,
  targetDate: Date,
  useLatestFallback = false
) {
  const exactOrNext = await getClosestPriceOnOrAfter(ticker, targetDate);

  if (exactOrNext) {
    return {
      row: exactOrNext,
      usedFallback: false,
    };
  }

  if (!useLatestFallback) {
    return {
      row: null,
      usedFallback: false,
    };
  }

  const latest = await getLatestPrice(ticker);

  return {
    row: latest,
    usedFallback: latest != null,
  };
}

async function main() {
  const options = parseOptions();
  const now = new Date();

  console.log("Backfilling REAL performance with SPY benchmark...");
  console.log("Options:", options);

  const allDisclosures = await withRetry("load disclosures", async () =>
    db.select().from(disclosures)
  );

  const summary = {
    disclosuresConsidered: 0,
    skippedMissingTickerOrDate: 0,
    skippedOutsideRecentWindow: 0,
    skippedExistingRows: 0,
    skippedMissingTradePrice: 0,
    created: 0,
    updated: 0,
  };

  let existingIds = new Set<number>();
  if (options.missingOnly) {
    const ids = await withRetry("load existing performance ids", async () =>
      db
        .select({ disclosureId: disclosurePerformanceWindows.disclosureId })
        .from(disclosurePerformanceWindows)
    );
    existingIds = new Set(ids.map((row) => row.disclosureId));
  }

  for (const disclosure of allDisclosures) {
    summary.disclosuresConsidered += 1;

    if (!disclosure.ticker || !disclosure.filingDate) {
      summary.skippedMissingTickerOrDate += 1;
      continue;
    }

    if (
      options.recentDays != null &&
      !isWithinRecentWindow(disclosure, options.recentDays, now)
    ) {
      summary.skippedOutsideRecentWindow += 1;
      continue;
    }

    if (options.missingOnly && existingIds.has(disclosure.id)) {
      summary.skippedExistingRows += 1;
      continue;
    }

    const tradeAnchorDate = startOfUtcDay(
      disclosure.tradeDate ?? disclosure.filingDate
    );
    const filingAnchorDate = startOfUtcDay(disclosure.filingDate);

    const normalizedTicker = disclosure.ticker.trim().toUpperCase();

    const tradePriceRow = await getClosestPriceOnOrAfter(
      normalizedTicker,
      tradeAnchorDate
    );

    const filingPriceRow = await getClosestPriceOnOrAfter(
      normalizedTicker,
      filingAnchorDate
    );

    if (!tradePriceRow) {
      summary.skippedMissingTradePrice += 1;
      continue;
    }

    const future7d = await resolveFuturePrice(
      normalizedTicker,
      addCalendarDays(tradeAnchorDate, 7),
      false
    );

    const future30d = await resolveFuturePrice(
      normalizedTicker,
      addCalendarDays(tradeAnchorDate, 30),
      false
    );

    const future90d = await resolveFuturePrice(
      normalizedTicker,
      addCalendarDays(tradeAnchorDate, 90),
      false
    );

    const spyTradePriceRow = await getClosestPriceOnOrAfter("SPY", tradeAnchorDate);

    const spyFuture7d = await resolveFuturePrice(
      "SPY",
      addCalendarDays(tradeAnchorDate, 7),
      false
    );

    const spyFuture30d = await resolveFuturePrice(
      "SPY",
      addCalendarDays(tradeAnchorDate, 30),
      false
    );

    const spyFuture90d = await resolveFuturePrice(
      "SPY",
      addCalendarDays(tradeAnchorDate, 90),
      false
    );

    const tradeDatePrice = Number(tradePriceRow.close);
    const filingDatePrice =
      filingPriceRow?.close != null ? Number(filingPriceRow.close) : null;

    const return7d =
      future7d.row?.close != null
        ? calcReturnPercent(tradeDatePrice, Number(future7d.row.close))
        : null;

    const return30d =
      future30d.row?.close != null
        ? calcReturnPercent(tradeDatePrice, Number(future30d.row.close))
        : null;

    const return90d =
      future90d.row?.close != null
        ? calcReturnPercent(tradeDatePrice, Number(future90d.row.close))
        : null;

    const spyTradeDatePrice =
      spyTradePriceRow?.close != null ? Number(spyTradePriceRow.close) : null;

    const spyReturn7d =
      spyTradeDatePrice != null && spyFuture7d.row?.close != null
        ? calcReturnPercent(spyTradeDatePrice, Number(spyFuture7d.row.close))
        : null;

    const spyReturn30d =
      spyTradeDatePrice != null && spyFuture30d.row?.close != null
        ? calcReturnPercent(spyTradeDatePrice, Number(spyFuture30d.row.close))
        : null;

    const spyReturn90d =
      spyTradeDatePrice != null && spyFuture90d.row?.close != null
        ? calcReturnPercent(spyTradeDatePrice, Number(spyFuture90d.row.close))
        : null;

    const payload = {
      ticker: normalizedTicker,
      tradeDatePrice: tradeDatePrice.toFixed(2),
      filingDatePrice:
        filingDatePrice != null ? filingDatePrice.toFixed(2) : null,
      return7d: return7d != null ? return7d.toFixed(2) : null,
      return30d: return30d != null ? return30d.toFixed(2) : null,
      return90d: return90d != null ? return90d.toFixed(2) : null,
      spyReturn7d: spyReturn7d != null ? spyReturn7d.toFixed(2) : null,
      spyReturn30d: spyReturn30d != null ? spyReturn30d.toFixed(2) : null,
      spyReturn90d: spyReturn90d != null ? spyReturn90d.toFixed(2) : null,
      updatedAt: new Date(),
    };

    const existing = await withRetry(`check existing performance row for ${disclosure.id}`, async () =>
      db
        .select({ disclosureId: disclosurePerformanceWindows.disclosureId })
        .from(disclosurePerformanceWindows)
        .where(eq(disclosurePerformanceWindows.disclosureId, disclosure.id))
        .limit(1)
    );

    if (existing.length > 0) {
      await withRetry(`update performance row for ${disclosure.id}`, async () =>
        db
          .update(disclosurePerformanceWindows)
          .set(payload)
          .where(eq(disclosurePerformanceWindows.disclosureId, disclosure.id))
      );
      summary.updated += 1;
    } else {
      await withRetry(`insert performance row for ${disclosure.id}`, async () =>
        db.insert(disclosurePerformanceWindows).values({
          disclosureId: disclosure.id,
          ...payload,
        })
      );
      summary.created += 1;
    }
  }

  console.log("Finished REAL performance backfill with SPY benchmark.");
  console.log("Backfill summary:", {
    ...summary,
    retries: retryCount,
    closestPriceCacheSize: closestPriceCache.size,
    latestPriceCacheSize: latestPriceCache.size,
  });
}

main().catch((err) => {
  console.error("Performance backfill failed:", err);
  process.exit(1);
});
