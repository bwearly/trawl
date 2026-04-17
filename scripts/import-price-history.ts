import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../lib/db";
import { disclosures, priceHistory } from "../lib/db/schema";
import { eq } from "drizzle-orm";

type AlphaVantageDailyRow = {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. volume": string;
};

type AlphaVantageTimeSeries = Record<string, AlphaVantageDailyRow>;

type AlphaVantageDailyResponse = {
  "Time Series (Daily)"?: AlphaVantageTimeSeries;
  Note?: string;
  Information?: string;
  ErrorMessage?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDaily(symbol: string): Promise<AlphaVantageTimeSeries> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not set");
  }

  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status}`);
  }

  const data = (await response.json()) as AlphaVantageDailyResponse;

  console.log(`Raw Alpha Vantage response for ${symbol}:`);
  console.dir(data, { depth: null });

  if (data.ErrorMessage) {
    throw new Error(`Alpha Vantage error for ${symbol}: ${data.ErrorMessage}`);
  }

  if (data.Note) {
    throw new Error(`Alpha Vantage rate limit hit for ${symbol}: ${data.Note}`);
  }

  if (data.Information) {
    throw new Error(
      `Alpha Vantage information for ${symbol}: ${data.Information}`
    );
  }

  const timeSeries = data["Time Series (Daily)"];

  if (!timeSeries) {
    throw new Error(`No daily data returned for ${symbol}`);
  }

  return timeSeries;
}

async function main() {
  console.log("Importing price history...");

    const disclosureRows = await db
    .select({ ticker: disclosures.ticker })
    .from(disclosures);

    const tickerSet = new Set<string>();

    for (const row of disclosureRows) {
    if (!row.ticker) continue;
    tickerSet.add(row.ticker.trim().toUpperCase());
    }

    tickerSet.add("SPY");

    const tickers = Array.from(tickerSet);

    console.log(`Found ${tickers.length} unique tickers: ${tickers.join(", ")}`);

  for (const ticker of tickers) {
    console.log(`Fetching ${ticker}...`);

    const series = await fetchDaily(ticker);

    await db.delete(priceHistory).where(eq(priceHistory.ticker, ticker));

    const rows = Object.entries(series).map(([date, values]) => ({
      ticker,
      date: new Date(`${date}T00:00:00Z`),
      open: values["1. open"],
      high: values["2. high"],
      low: values["3. low"],
      close: values["4. close"],
      adjustedClose: values["4. close"], // placeholder until you use a true adjusted source
      volume: Number(values["5. volume"]),
      updatedAt: new Date(),
    }));

    if (rows.length > 0) {
      await db.insert(priceHistory).values(rows);
    }

    console.log(`Inserted ${rows.length} rows for ${ticker}.`);

    // free plan is limited, so stay conservative
    await sleep(15000);
  }

  console.log("Finished importing price history.");
}

main().catch((err) => {
  console.error("Price import failed:", err);
  process.exit(1);
});