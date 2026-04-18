import Link from "next/link";
import SignalCard from "@/components/signals/SignalCard";
import { getTopPicks } from "@/lib/domain/signals/get-top-picks";

export default async function Home() {
  const topPicks = await getTopPicks(6);

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="rounded-3xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
              Trawl
            </p>

            <h1 className="mt-4 text-5xl font-bold tracking-tight text-gray-950">
              Public-disclosure stock research signals
            </h1>

            <p className="mt-6 text-lg leading-8 text-gray-600">
              Monitor congressional trade disclosures, score them as research
              signals, and review the context before doing any deeper work.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signals"
                className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-black"
              >
                View signals
              </Link>

              <Link
                href="/signals?minScore=70&sort=score"
                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                View high-score signals
              </Link>
            </div>
          </div>
        </div>

        <section className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
                Daily shortlist
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                Top Picks Today
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">
                Highest-scoring active disclosures worth reviewing based on
                score, market follow-through, and current supporting data.
              </p>
            </div>

            <Link
              href="/signals"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              View all signals →
            </Link>
          </div>

          <div className="mt-6 space-y-5">
            {topPicks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">
                No top picks available yet.
              </div>
            ) : (
              topPicks.map((signal, index) => (
                <div key={signal.signalId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                      Top Pick
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      #{index + 1}
                    </span>
                  </div>

                  <SignalCard
                    signalId={signal.signalId}
                    ticker={signal.ticker}
                    score={signal.score}
                    politicianId={signal.politicanId}
                    politicianName={signal.politicianName}
                    tradeType={signal.tradeType}
                    ownerType={signal.ownerType}
                    amountRangeLabel={signal.amountRangeLabel}
                    tradeDate={signal.tradeDate}
                    filingDate={signal.filingDate}
                    filingLagDays={signal.filingLagDays}
                    sourceUrl={signal.sourceUrl}
                    primaryReason={signal.primaryReason}
                    reasonSummary={signal.reasonSummary}
                  />
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}