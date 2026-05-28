import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";
import { db } from "@/lib/db";

function normalizeQuery(value: string) {
  return value.trim();
}

function isTickerLike(value: string) {
  return /^[A-Za-z.\-]{1,10}$/.test(value.trim());
}

function emptySearchResponse() {
  return {
    politicians: [],
    tickers: [],
    signals: [],
  };
}

export async function GET(request: NextRequest) {
  const query = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");

  if (!query || query.length < 2) {
    return NextResponse.json(emptySearchResponse());
  }

  const politicianLimit = 6;
  const tickerLimit = 6;
  const signalLimit = 5;

  const politicianRows = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
    })
    .from(politicians)
    .where(
      or(
        ilike(politicians.fullName, `%${query}%`),
        ilike(
          sql`concat(${politicians.fullName}, ' ', coalesce(${politicians.party}, ''), ' ', coalesce(${politicians.state}, ''))`,
          `%${query}%`
        )
      )
    )
    .orderBy(asc(politicians.fullName))
    .limit(politicianLimit);

  const tickerQuery = query.toUpperCase();

  const tickerRows = await db
    .select({
      ticker: disclosures.ticker,
      assetName: sql<string | null>`min(${disclosures.assetName})`.as("asset_name"),
      disclosureCount: sql<number>`count(*)::int`.as("disclosure_count"),
      lastTradeDate: sql<Date | null>`max(${disclosures.tradeDate})`.as(
        "last_trade_date"
      ),
    })
    .from(disclosures)
    .where(
      isTickerLike(query)
        ? ilike(disclosures.ticker, `%${tickerQuery}%`)
        : or(
            ilike(disclosures.ticker, `%${tickerQuery}%`),
            ilike(disclosures.assetName, `%${query}%`)
          )
    )
    .groupBy(disclosures.ticker)
    .orderBy(
      desc(sql`count(*)`),
      desc(sql`max(${disclosures.tradeDate})`),
      asc(disclosures.ticker)
    )
    .limit(tickerLimit);

  const signalRows = await db
    .select({
      id: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalDate: researchSignals.signalDate,
      primaryReason: researchSignals.primaryReason,
      politicianName: politicians.fullName,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(
      or(
        ilike(researchSignals.ticker, `%${tickerQuery}%`),
        ilike(politicians.fullName, `%${query}%`),
        ilike(disclosures.assetName, `%${query}%`),
        ilike(researchSignals.primaryReason, `%${query}%`),
        ilike(researchSignals.reasonSummary, `%${query}%`)
      )
    )
    .orderBy(desc(researchSignals.signalDate), desc(researchSignals.score))
    .limit(signalLimit);

  return NextResponse.json({
    politicians: politicianRows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      chamber: row.chamber,
      party: row.party,
      state: row.state,
      href: `/politicians/${row.id}`,
      type: "politician" as const,
    })),
    tickers: tickerRows
      .filter((row) => row.ticker)
      .map((row) => ({
        ticker: row.ticker as string,
        assetName: row.assetName,
        disclosureCount: row.disclosureCount,
        lastTradeDate: row.lastTradeDate,
        href: `/tickers/${encodeURIComponent(row.ticker as string)}`,
        type: "ticker" as const,
      })),
    signals: signalRows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      politicianName: row.politicianName,
      score: row.score,
      primaryReason: row.primaryReason,
      signalDate: row.signalDate,
      href: `/signals/${row.id}`,
      type: "signal" as const,
    })),
  });
}
