import { config } from "dotenv";
config({ path: ".env.local" });

import YahooFinance from "yahoo-finance2";
import { db } from "../lib/db";
import { disclosures, priceHistory } from "../lib/db/schema";
import { eq } from "drizzle-orm";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeYahooSymbol(symbol: string) {
  switch (symbol) {
    case "BRK.B":
      return "BRK-B";
    default:
      return symbol;
  }
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
    const ticker = row.ticker?.trim().toUpperCase();
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

  console.log(
    `Found ${tickers.length} unique tickers: ${tickers
      .map((entry) => entry.ticker)
      .join(", ")}`
  );

  for (const { ticker, earliestAnchorDate } of tickers) {
    const yahooSymbol = normalizeYahooSymbol(ticker);
    const periodStart = addDays(earliestAnchorDate, -10);

    console.log(
      `Fetching ${ticker} (Yahoo: ${yahooSymbol}) from ${periodStart.toISOString().slice(0, 10)}...`
    );

    const quotes = await fetchDailyHistory(yahooSymbol, periodStart);

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

    console.log(`Inserted ${rows.length} rows for ${ticker}.`);

    await sleep(1000);
  }

  console.log("Finished importing price history.");
}

main().catch((err) => {
  console.error("Price import failed:", err);
  process.exit(1);
});
