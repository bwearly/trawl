import Link from "next/link";
import type { Metadata } from "next";
import SignalCard from "@/components/signals/SignalCard";
import { getBiggestOutperformers } from "@/lib/domain/signals/get-biggest-outperformers";
import { getRecentlyFiled } from "@/lib/domain/signals/get-recently-filed";
import { getTopPicks } from "@/lib/domain/signals/get-top-picks";

export const metadata: Metadata = {
  title: "Trawl — Congressional Trade Signals",
  description:
    "Track congressional trade disclosures, find ranked opportunities, validate performance, and stay on top of watchlists and alerts.",
};

export default async function Home() {
  const [topPicks, recentlyFiled, biggestOutperformers] = await Promise.all([
    getTopPicks(4),
    getRecentlyFiled(4),
    getBiggestOutperformers(4),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
              Trawl
            </p>

            <h1 className="mt-4 text-5xl font-bold tracking-tight text-gray-950">
              Turn congressional filings into a daily investing research workflow
            </h1>

            <p className="mt-6 text-lg leading-8 text-gray-600">
              Trawl helps you find new congressional trades, prioritize the
              strongest signals, and validate what has historically worked—all
              in one place.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signals"
                className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-black"
              >
                View signals
              </Link>

              <Link
                href="/politicians"
                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Politicians
              </Link>

              <Link
                href="/watchlist"
                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Watchlist
              </Link>

              <Link
                href="/alerts"
                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Alerts
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-3xl border border-gray-200 bg-white p-8 shadow-sm md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
              Start here
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">
              How to use Trawl in 3 steps
            </h2>
            <p className="mt-3 text-base text-gray-600">
              Use this quick loop to go from discovery to monitoring.
            </p>
          </div>

          <ol className="space-y-3 text-sm text-gray-700">
            <li className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <span className="font-semibold text-gray-900">1.</span> Open{" "}
              <Link href="/signals" className="font-semibold text-gray-900 underline">
                signals
              </Link>{" "}
              and review today&apos;s top-ranked ideas.
            </li>
            <li className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <span className="font-semibold text-gray-900">2.</span> Save key
              names in your{" "}
              <Link
                href="/watchlist"
                className="font-semibold text-gray-900 underline"
              >
                watchlist
              </Link>
              .
            </li>
            <li className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <span className="font-semibold text-gray-900">3.</span> Use{" "}
              <Link href="/alerts" className="font-semibold text-gray-900 underline">
                alerts
              </Link>{" "}
              to stay updated when new filings hit.
            </li>
          </ol>
        </section>

        <section className="rounded-3xl border border-blue-200 bg-gradient-to-b from-blue-50 to-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
                Top signals right now
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                Top Picks Today
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">
                Strong current research signals, ranked so you can start with
                the highest-priority opportunities.
              </p>
            </div>

            <Link
              href="/signals"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              View all signals →
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {topPicks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-blue-300 bg-white p-10 text-center text-sm text-gray-500">
                No top picks available yet.
              </div>
            ) : (
              topPicks.map((signal, index) => (
                <div key={signal.signalId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
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
                    signalStatus={signal.signalStatus}
                    politicianId={signal.politicianId}
                    politicianName={signal.politicianName}
                    tradeType={signal.tradeType}
                    ownerType={signal.ownerType}
                    amountRangeLabel={signal.amountRangeLabel}
                    tradeDate={signal.tradeDate}
                    filingDate={signal.filingDate}
                    filingLagDays={signal.filingLagDays}
                    return7d={signal.return7d}
                    return30d={signal.return30d}
                    historicalSampleSize={signal.historicalSampleSize}
                    sourceUrl={signal.sourceUrl}
                    primaryReason={signal.primaryReason}
                    reasonSummary={signal.reasonSummary}
                  />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
                Newest disclosures
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                Recently Filed
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">
                The latest congressional disclosures, ordered by filing time.
              </p>
            </div>

            <Link
              href="/signals?sort=newest"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              View newest filings →
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {recentlyFiled.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-amber-300 bg-white p-10 text-center text-sm text-gray-500">
                No recent filings available yet.
              </div>
            ) : (
              recentlyFiled.map((signal) => (
                <SignalCard
                  key={signal.signalId}
                  signalId={signal.signalId}
                  ticker={signal.ticker}
                  score={signal.score}
                  signalStatus={signal.signalStatus}
                  politicianId={signal.politicianId}
                  politicianName={signal.politicianName}
                  tradeType={signal.tradeType}
                  ownerType={signal.ownerType}
                  amountRangeLabel={signal.amountRangeLabel}
                  tradeDate={signal.tradeDate}
                  filingDate={signal.filingDate}
                  filingLagDays={signal.filingLagDays}
                  return7d={signal.return7d}
                  return30d={signal.return30d}
                  historicalSampleSize={signal.historicalSampleSize}
                  sourceUrl={signal.sourceUrl}
                  primaryReason={signal.primaryReason}
                  reasonSummary={signal.reasonSummary}
                />
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                Proven follow-through
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                Biggest Outperformers vs SPY
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">
                Historical performance leaders that beat SPY by the widest
                margin.
              </p>
            </div>

            <Link
              href="/signals"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              View all signals →
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {biggestOutperformers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-300 bg-white p-10 text-center text-sm text-gray-500">
                No outperformers with SPY comparison data yet.
              </div>
            ) : (
              biggestOutperformers.map((signal, index) => (
                <div key={signal.signalId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Outperformer
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      #{index + 1} · {signal.chosenAlphaWindow} alpha{" "}
                      {signal.chosenAlpha >= 0 ? "+" : ""}
                      {signal.chosenAlpha.toFixed(2)}%
                    </span>
                  </div>

                  <SignalCard
                    signalId={signal.signalId}
                    ticker={signal.ticker}
                    score={signal.score}
                    signalStatus={signal.signalStatus}
                    politicianId={signal.politicianId}
                    politicianName={signal.politicianName}
                    tradeType={signal.tradeType}
                    ownerType={signal.ownerType}
                    amountRangeLabel={signal.amountRangeLabel}
                    tradeDate={signal.tradeDate}
                    filingDate={signal.filingDate}
                    filingLagDays={signal.filingLagDays}
                    return7d={signal.return7d}
                    return30d={signal.return30d}
                    historicalSampleSize={signal.historicalSampleSize}
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
