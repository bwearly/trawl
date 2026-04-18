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

async function fetchDailyHistory(symbol: string): Promise<YahooPriceRow[]> {
  const end = new Date();
  const start = new Date();
  start.setUTCFullYear(end.getUTCFullYear() - 1);

  const result = (await yahooFinance.chart(symbol, {
    period1: start,
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
    .select({ ticker: disclosures.ticker })
    .from(disclosures);

  const tickers = Array.from(
    new Set(
      disclosureRows
        .map((row) => row.ticker)
        .filter((ticker): ticker is string => Boolean(ticker))
    )
  );

  console.log(`Found ${tickers.length} unique tickers: ${tickers.join(", ")}`);

  for (const ticker of tickers) {
    const yahooSymbol = normalizeYahooSymbol(ticker);

    console.log(`Fetching ${ticker} (Yahoo: ${yahooSymbol})...`);

    const quotes = await fetchDailyHistory(yahooSymbol);

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