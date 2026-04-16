import "dotenv/config";
import { db } from "../lib/db";
import { disclosures, politicians, researchSignals } from "../lib/db/schema";

async function main() {
  console.log("🌱 Starting Trawl seed...");
  console.log("🧹 Clearing existing demo records...");

  await db.delete(researchSignals);
  await db.delete(disclosures);
  await db.delete(politicians);

  console.log("👤 Inserting politicians...");
  const politicianRows = await db
    .insert(politicians)
    .values([
      {
        fullName: "Nancy Pelosi",
        chamber: "house",
        party: "Democrat",
        state: "CA",
      },
      {
        fullName: "Dan Crenshaw",
        chamber: "house",
        party: "Republican",
        state: "TX",
      },
      {
        fullName: "Tommy Tuberville",
        chamber: "senate",
        party: "Republican",
        state: "AL",
      },
      {
        fullName: "Ron Wyden",
        chamber: "senate",
        party: "Democrat",
        state: "OR",
      },
      {
        fullName: "Angus King",
        chamber: "senate",
        party: "Independent",
        state: "ME",
      },
    ])
    .returning();

  const [pelosi, crenshaw, tuberville, wyden, king] = politicianRows;
  console.log(`✅ Inserted ${politicianRows.length} politicians.`);

  console.log("📄 Inserting disclosures...");
  const disclosureRows = await db
    .insert(disclosures)
    .values([
      {
        politicianId: pelosi.id,
        ticker: "NVDA",
        assetName: "NVIDIA Corporation",
        assetType: "stock",
        tradeType: "purchase",
        ownerType: "spouse",
        amountMin: 15001,
        amountMax: 50000,
        amountRangeLabel: "$15,001 - $50,000",
        tradeDate: new Date("2026-03-10T00:00:00Z"),
        filingDate: new Date("2026-04-04T00:00:00Z"),
        filingLagDays: 25,
        sourceUrl: "https://example.com/filing/nvda",
        sourceLabel: "Official Filing",
      },
      {
        politicianId: crenshaw.id,
        ticker: "PLTR",
        assetName: "Palantir Technologies",
        assetType: "stock",
        tradeType: "purchase",
        ownerType: "self",
        amountMin: 1001,
        amountMax: 15000,
        amountRangeLabel: "$1,001 - $15,000",
        tradeDate: new Date("2026-04-08T00:00:00Z"),
        filingDate: new Date("2026-04-12T00:00:00Z"),
        filingLagDays: 4,
        sourceUrl: "https://example.com/filing/pltr",
        sourceLabel: "Official Filing",
      },
      {
        politicianId: tuberville.id,
        ticker: "TSLA",
        assetName: "Tesla, Inc.",
        assetType: "stock",
        tradeType: "sale",
        ownerType: "spouse",
        amountMin: 50001,
        amountMax: 100000,
        amountRangeLabel: "$50,001 - $100,000",
        tradeDate: new Date("2026-03-20T00:00:00Z"),
        filingDate: new Date("2026-04-14T00:00:00Z"),
        filingLagDays: 25,
        sourceUrl: "https://example.com/filing/tsla",
        sourceLabel: "Official Filing",
      },
      {
        politicianId: wyden.id,
        ticker: "MSFT",
        assetName: "Microsoft Corporation",
        assetType: "stock",
        tradeType: "purchase",
        ownerType: "self",
        amountMin: 15001,
        amountMax: 50000,
        amountRangeLabel: "$15,001 - $50,000",
        tradeDate: new Date("2026-04-01T00:00:00Z"),
        filingDate: new Date("2026-04-10T00:00:00Z"),
        filingLagDays: 9,
        sourceUrl: "https://example.com/filing/msft",
        sourceLabel: "Official Filing",
      },
      {
        politicianId: pelosi.id,
        ticker: "AMZN",
        assetName: "Amazon.com, Inc.",
        assetType: "stock",
        tradeType: "purchase",
        ownerType: "spouse",
        amountMin: 100001,
        amountMax: 250000,
        amountRangeLabel: "$100,001 - $250,000",
        tradeDate: new Date("2026-04-05T00:00:00Z"),
        filingDate: new Date("2026-04-15T00:00:00Z"),
        filingLagDays: 10,
        sourceUrl: "https://example.com/filing/amzn",
        sourceLabel: "Official Filing",
      },
      {
        politicianId: king.id,
        ticker: "GOOGL",
        assetName: "Alphabet Inc.",
        assetType: "stock",
        tradeType: "exchange",
        ownerType: "self",
        amountMin: 15001,
        amountMax: 50000,
        amountRangeLabel: "$15,001 - $50,000",
        tradeDate: new Date("2026-04-06T00:00:00Z"),
        filingDate: new Date("2026-04-13T00:00:00Z"),
        filingLagDays: 7,
        sourceUrl: "https://example.com/filing/googl",
        sourceLabel: "Official Filing",
      },
    ])
    .returning();

  console.log(`✅ Inserted ${disclosureRows.length} disclosures.`);

  console.log("📈 Inserting research signals...");
  const signalRows = await db
    .insert(researchSignals)
    .values([
      {
        disclosureId: disclosureRows[0].id,
        politicianId: pelosi.id,
        ticker: "NVDA",
        score: "84.00",
        signalStatus: "active",
        primaryReason: "Historically strong performer",
        reasonSummary:
          "Historically strong performer, relevant sector overlap, and positive short-term momentum.",
        tradeTypeScore: "18.00",
        tradeSizeScore: "12.00",
        filingFreshnessScore: "10.00",
        historicalPoliticianScore: "17.00",
        momentumScore: "9.00",
        committeeRelevanceScore: "8.00",
        clusterScore: "6.00",
        userRelevanceScore: "4.00",
        signalDate: new Date("2026-04-16T00:00:00Z"),
      },
      {
        disclosureId: disclosureRows[1].id,
        politicianId: crenshaw.id,
        ticker: "PLTR",
        score: "78.00",
        signalStatus: "active",
        primaryReason: "Fast filing and strong theme alignment",
        reasonSummary:
          "Quick filing lag, strong defense-tech narrative, and strong recent momentum.",
        tradeTypeScore: "18.00",
        tradeSizeScore: "8.00",
        filingFreshnessScore: "15.00",
        historicalPoliticianScore: "10.00",
        momentumScore: "11.00",
        committeeRelevanceScore: "9.00",
        clusterScore: "4.00",
        userRelevanceScore: "3.00",
        signalDate: new Date("2026-04-17T00:00:00Z"),
      },
      {
        disclosureId: disclosureRows[2].id,
        politicianId: tuberville.id,
        ticker: "TSLA",
        score: "52.00",
        signalStatus: "active",
        primaryReason: "Large sale worth reviewing",
        reasonSummary:
          "Large reported sale and recognizable ticker, but weaker signal quality than recent purchases.",
        tradeTypeScore: "8.00",
        tradeSizeScore: "14.00",
        filingFreshnessScore: "9.00",
        historicalPoliticianScore: "6.00",
        momentumScore: "5.00",
        committeeRelevanceScore: "3.00",
        clusterScore: "4.00",
        userRelevanceScore: "3.00",
        signalDate: new Date("2026-04-18T00:00:00Z"),
      },
      {
        disclosureId: disclosureRows[3].id,
        politicianId: wyden.id,
        ticker: "MSFT",
        score: "73.00",
        signalStatus: "active",
        primaryReason: "Fresh purchase with strong quality profile",
        reasonSummary:
          "Fresh purchase with respectable filing lag and strong large-cap quality backdrop.",
        tradeTypeScore: "18.00",
        tradeSizeScore: "11.00",
        filingFreshnessScore: "13.00",
        historicalPoliticianScore: "9.00",
        momentumScore: "8.00",
        committeeRelevanceScore: "7.00",
        clusterScore: "4.00",
        userRelevanceScore: "3.00",
        signalDate: new Date("2026-04-19T00:00:00Z"),
      },
      {
        disclosureId: disclosureRows[4].id,
        politicianId: pelosi.id,
        ticker: "AMZN",
        score: "88.00",
        signalStatus: "active",
        primaryReason: "Large purchase with strong context",
        reasonSummary:
          "Large purchase, strong historical attention, and attractive short-term research setup.",
        tradeTypeScore: "18.00",
        tradeSizeScore: "15.00",
        filingFreshnessScore: "12.00",
        historicalPoliticianScore: "18.00",
        momentumScore: "9.00",
        committeeRelevanceScore: "8.00",
        clusterScore: "5.00",
        userRelevanceScore: "3.00",
        signalDate: new Date("2026-04-20T00:00:00Z"),
      },
      {
        disclosureId: disclosureRows[5].id,
        politicianId: king.id,
        ticker: "GOOGL",
        score: "66.00",
        signalStatus: "active",
        primaryReason: "Portfolio rotation into megacap tech",
        reasonSummary:
          "Recent exchange into a large-cap technology name with moderate filing freshness and committee relevance.",
        tradeTypeScore: "12.00",
        tradeSizeScore: "10.00",
        filingFreshnessScore: "12.00",
        historicalPoliticianScore: "8.00",
        momentumScore: "7.00",
        committeeRelevanceScore: "8.00",
        clusterScore: "5.00",
        userRelevanceScore: "4.00",
        signalDate: new Date("2026-04-21T00:00:00Z"),
      },
    ])
    .returning();

  console.log(`✅ Inserted ${signalRows.length} research signals.`);
  console.log("🎉 Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
