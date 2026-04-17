import { config } from "dotenv";
config({ path: ".env.local" });

import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  priceHistory,
} from "../lib/db/schema";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function calcReturnPercent(start: number, end: number) {
  if (start === 0) return 0;
  return round2(((end - start) / start) * 100);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

async function getClosestPriceOnOrAfter(ticker: string, targetDate: Date) {
  const normalizedTarget = startOfUtcDay(targetDate);

  const rows = await db
    .select()
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.ticker, ticker),
        gte(priceHistory.date, normalizedTarget)
      )
    )
    .orderBy(asc(priceHistory.date))
    .limit(1);

  return rows[0] ?? null;
}

async function getLatestPrice(ticker: string) {
  const rows = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.ticker, ticker))
    .orderBy(desc(priceHistory.date))
    .limit(1);

  return rows[0] ?? null;
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
  console.log("Backfilling REAL performance with SPY benchmark...");

  const allDisclosures = await db.select().from(disclosures);

  console.log(`Found ${allDisclosures.length} disclosures.`);

  for (const disclosure of allDisclosures) {
    if (!disclosure.ticker || !disclosure.filingDate) {
      console.log(
        `Skipping disclosure ${disclosure.id} because ticker or filingDate is missing.`
      );
      continue;
    }

    const tradeAnchorDate = startOfUtcDay(
      disclosure.tradeDate ?? disclosure.filingDate
    );
    const filingAnchorDate = startOfUtcDay(disclosure.filingDate);

    const normalizedTicker = disclosure.ticker.trim().toUpperCase();

    // Stock price anchors
    const tradePriceRow = await getClosestPriceOnOrAfter(
      normalizedTicker,
      tradeAnchorDate
    );

    const filingPriceRow = await getClosestPriceOnOrAfter(
      normalizedTicker,
      filingAnchorDate
    );

    if (!tradePriceRow) {
      console.log(
        `Skipping disclosure ${disclosure.id} (${normalizedTicker}) because no trade-date price was found.`
      );
      continue;
    }

    const future7d = await resolveFuturePrice(
      normalizedTicker,
      addDays(tradeAnchorDate, 7),
      false
    );

    const future30d = await resolveFuturePrice(
      normalizedTicker,
      addDays(tradeAnchorDate, 30),
      false
    );

    const future90d = await resolveFuturePrice(
      normalizedTicker,
      addDays(tradeAnchorDate, 90),
      false
    );

    // SPY price anchors
    const spyTradePriceRow = await getClosestPriceOnOrAfter("SPY", tradeAnchorDate);

    const spyFuture7d = await resolveFuturePrice(
      "SPY",
      addDays(tradeAnchorDate, 7),
      false
    );

    const spyFuture30d = await resolveFuturePrice(
      "SPY",
      addDays(tradeAnchorDate, 30),
      false
    );

    const spyFuture90d = await resolveFuturePrice(
      "SPY",
      addDays(tradeAnchorDate, 90),
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

    const existing = await db
      .select()
      .from(disclosurePerformanceWindows)
      .where(eq(disclosurePerformanceWindows.disclosureId, disclosure.id))
      .limit(1);

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

    if (existing.length > 0) {
      await db
        .update(disclosurePerformanceWindows)
        .set(payload)
        .where(eq(disclosurePerformanceWindows.disclosureId, disclosure.id));

      console.log(
        `Updated performance for disclosure ${disclosure.id} (${normalizedTicker})`
      );
    } else {
      await db.insert(disclosurePerformanceWindows).values({
        disclosureId: disclosure.id,
        ...payload,
      });

      console.log(
        `Created performance for disclosure ${disclosure.id} (${normalizedTicker})`
      );
    }

    console.log({
      disclosureId: disclosure.id,
      ticker: normalizedTicker,
      tradeAnchorDate,
      tradeDatePrice,
      filingDatePrice,
      return7d,
      return30d,
      return90d,
      spyTradeDatePrice,
      spyReturn7d,
      spyReturn30d,
      spyReturn90d,
    });
  }

  console.log("Finished REAL performance backfill with SPY benchmark.");
}

main().catch((err) => {
  console.error("Performance backfill failed:", err);
  process.exit(1);
});