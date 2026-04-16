import "dotenv/config";
import { db } from "../lib/db";
import { disclosures, politicians, researchSignals } from "../lib/db/schema";

async function main() {
  console.log("Seeding database...");

  const [politician] = await db
    .insert(politicians)
    .values({
      fullName: "Nancy Pelosi",
      chamber: "house",
      party: "Democrat",
      state: "CA",
    })
    .returning();

  console.log("Inserted politician:", politician);

  const [disclosure] = await db
    .insert(disclosures)
    .values({
      politicianId: politician.id,
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
      sourceUrl: "https://example.com/official-filing",
      sourceLabel: "Official Filing",
    })
    .returning();

  console.log("Inserted disclosure:", disclosure);

  const [signal] = await db
    .insert(researchSignals)
    .values({
      disclosureId: disclosure.id,
      politicianId: politician.id,
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
    })
    .returning();

  console.log("Inserted signal:", signal);
  console.log("Seeding complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});