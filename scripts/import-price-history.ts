import { config } from "dotenv";
config({ path: ".env.local" });

import YahooFinance from "yahoo-finance2";
import { db } from "../lib/db";
import { disclosures, priceHistory } from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import {
  normalizeTickerForStorage,
  normalizeYahooSymbol,
} from "../lib/domain/pipeline/normalization";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

type YahooChartQuote = {
  date: Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
};

type YahooChartResultArray = {
  quotes: YahooChartQuote[];
};

type YahooPriceRow = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type TickerWindow = {
  ticker: string;
  earliestAnchorDate: Date;
};

type PriceImportFailureReason =
  | "rate_limited"
  | "no_data"
  | "invalid_symbol"
  | "request_error";

type TickerFetchResult = {
  ticker: string;
  yahooSymbol: string;
  reason: PriceImportFailureReason;
  detail: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function fetchDailyHistory(
  symbol: string,
  period1: Date
): Promise<YahooPriceRow[]> {
  const end = new Date();

  const result = (await yahooFinance.chart(symbol, {
    period1,
    period2: end,
    interval: "1d",
  })) as YahooChartResultArray;

  const quotes = result.quotes ?? [];

  return quotes
    .filter((q: YahooChartQuote) => q.date && q.close != null)
    .map((q: YahooChartQuote) => ({
      date: q.date,
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close ?? null,
      volume: q.volume ?? null,
    }));
}

function classifyYahooError(error: unknown): {
  reason: PriceImportFailureReason;
  detail: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return { reason: "rate_limited", detail: message };
  }

  if (
    normalized.includes("delisted") ||
    normalized.includes("not found") ||
    normalized.includes("invalid") ||
    normalized.includes("symbol")
  ) {
    return { reason: "invalid_symbol", detail: message };
  }

  if (normalized.includes("no data")) {
    return { reason: "no_data", detail: message };
  }

  return { reason: "request_error", detail: message };
}

async function main() {
  console.log("Importing price history from Yahoo Finance...");

  const disclosureRows = await db
    .select({
      ticker: disclosures.ticker,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
    })
    .from(disclosures);

  const tickerWindows = new Map<string, Date>();

  for (const row of disclosureRows) {
    const ticker = row.ticker ? normalizeTickerForStorage(row.ticker) : null;
    if (!ticker) continue;

    const anchorDate = row.tradeDate ?? row.filingDate;
    if (!anchorDate) continue;

    const normalizedAnchor = startOfUtcDay(anchorDate);
    const existing = tickerWindows.get(ticker);
    if (!existing || normalizedAnchor < existing) {
      tickerWindows.set(ticker, normalizedAnchor);
    }
  }

  const tickers: TickerWindow[] = Array.from(tickerWindows.entries()).map(
    ([ticker, earliestAnchorDate]) => ({
      ticker,
      earliestAnchorDate,
    })
  );

  const existingCoverageRows = await db
    .select({
      ticker: priceHistory.ticker,
      count: sql<number>`count(*)`,
    })
    .from(priceHistory)
    .groupBy(priceHistory.ticker);
  const coveredTickerSet = new Set(
    existingCoverageRows
      .map((row) => normalizeTickerForStorage(row.ticker))
      .filter((ticker) => ticker.length > 0)
  );

  const neededTickerSet = new Set(tickers.map((entry) => entry.ticker));
  const alreadyCoveredNeededTickers = [...neededTickerSet].filter((ticker) =>
    coveredTickerSet.has(ticker)
  );

  const attemptedTickers: string[] = [];
  const succeededTickers: string[] = [];
  const failedTickers: TickerFetchResult[] = [];

  console.log(`Diagnostics: needed tickers from disclosures=${neededTickerSet.size}`);
  console.log(`Diagnostics: tickers already covered in price_history=${alreadyCoveredNeededTickers.length}`);

  console.log(
    `Found ${tickers.length} unique tickers: ${tickers
      .map((entry) => entry.ticker)
      .join(", ")}`
  );

  for (const { ticker, earliestAnchorDate } of tickers) {
    const yahooSymbol = normalizeYahooSymbol(ticker);
    const periodStart = addDays(earliestAnchorDate, -10);
    attemptedTickers.push(ticker);

    console.log(
      `Fetching ${ticker} (Yahoo: ${yahooSymbol}) from ${periodStart.toISOString().slice(0, 10)}...`
    );

    let quotes: YahooPriceRow[] = [];
    try {
      quotes = await fetchDailyHistory(yahooSymbol, periodStart);
    } catch (error) {
      const classified = classifyYahooError(error);
      failedTickers.push({
        ticker,
        yahooSymbol,
        reason: classified.reason,
        detail: classified.detail,
      });
      console.log(
        `❌ Failed ${ticker} (Yahoo: ${yahooSymbol}) reason=${classified.reason} detail="${classified.detail}"`
      );
      await sleep(1000);
      continue;
    }

    if (quotes.length === 0) {
      failedTickers.push({
        ticker,
        yahooSymbol,
        reason: "no_data",
        detail: "Yahoo returned 0 daily quote rows",
      });
      console.log(`⚠️ No data for ${ticker} (Yahoo: ${yahooSymbol}).`);
      await sleep(1000);
      continue;
    }

    await db.delete(priceHistory).where(eq(priceHistory.ticker, ticker));

    const rows = quotes.map((quote) => ({
      ticker,
      date: quote.date,
      open: quote.open != null ? quote.open.toFixed(2) : null,
      high: quote.high != null ? quote.high.toFixed(2) : null,
      low: quote.low != null ? quote.low.toFixed(2) : null,
      close: quote.close != null ? quote.close.toFixed(2) : null,
      adjustedClose: quote.close != null ? quote.close.toFixed(2) : null,
      volume: quote.volume ?? 0,
      updatedAt: new Date(),
    }));

    if (rows.length > 0) {
      await db.insert(priceHistory).values(rows);
    }
    succeededTickers.push(ticker);

    console.log(`Inserted ${rows.length} rows for ${ticker}.`);

    await sleep(1000);
  }

  const postImportCoverageRows = await db
    .select({
      ticker: priceHistory.ticker,
    })
    .from(priceHistory)
    .groupBy(priceHistory.ticker);
  const postImportCoveredTickers = new Set(
    postImportCoverageRows.map((row) => normalizeTickerForStorage(row.ticker))
  );
  const missingNeededTickers = [...neededTickerSet].filter(
    (ticker) => !postImportCoveredTickers.has(ticker)
  );

  console.log("Diagnostics summary:");
  console.log(`  - tickers needed from disclosures: ${neededTickerSet.size}`);
  console.log(`  - tickers already covered in price_history: ${alreadyCoveredNeededTickers.length}`);
  console.log(`  - tickers attempted: ${attemptedTickers.length}`);
  console.log(`  - tickers succeeded: ${succeededTickers.length}`);
  console.log(`  - tickers failed: ${failedTickers.length}`);

  if (failedTickers.length > 0) {
    writeFileSync(
      "tmp/price-import-unresolved-symbols.json",
      `${JSON.stringify(failedTickers, null, 2)}\n`,
      "utf8"
    );
    console.log("  - unresolved symbol report: tmp/price-import-unresolved-symbols.json");
    console.log("  - failure reason per ticker:");
    for (const failure of failedTickers) {
      console.log(
        `    * ${failure.ticker} (Yahoo: ${failure.yahooSymbol}) -> ${failure.reason} | ${failure.detail}`
      );
    }
  }

  const rateLimitedFailures = failedTickers.filter((row) => row.reason === "rate_limited").length;
  const noDataFailures = failedTickers.filter((row) => row.reason === "no_data").length;
  console.log(`  - API rate-limit detected failures: ${rateLimitedFailures}`);
  console.log(`  - API no-data detected failures: ${noDataFailures}`);

  console.log("  - top missing valid tickers after price import:");
  if (missingNeededTickers.length === 0) {
    console.log("    * none");
  } else {
    for (const ticker of missingNeededTickers.slice(0, 25)) {
      console.log(`    * ${ticker}`);
    }
  }

  console.log("Finished importing price history.");
}

main().catch((err) => {
  console.error("Price import failed:", err);
  process.exit(1);
});
