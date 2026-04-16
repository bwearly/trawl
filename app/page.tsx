import { desc, eq } from "drizzle-orm";
import SignalCard from "@/components/signals/SignalCard";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";

export default async function Home() {
  const rows = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      politicianName: politicians.fullName,
      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountRangeLabel: disclosures.amountRangeLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      sourceUrl: disclosures.sourceUrl,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .orderBy(desc(researchSignals.score));

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-4xl font-bold tracking-tight text-gray-950">
          Research Signals
        </h1>

        <div className="space-y-5">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
              No signals yet.
            </div>
          ) : (
            rows.map((row) => (
              <SignalCard
                key={row.signalId}
                signalId={row.signalId}
                ticker={row.ticker}
                score={row.score}
                politicianName={row.politicianName}
                tradeType={row.tradeType}
                ownerType={row.ownerType}
                amountRangeLabel={row.amountRangeLabel}
                tradeDate={row.tradeDate}
                filingDate={row.filingDate}
                filingLagDays={row.filingLagDays}
                sourceUrl={row.sourceUrl}
                primaryReason={row.primaryReason}
                reasonSummary={row.reasonSummary}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
}