"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SignalCard from "@/components/signals/SignalCard";
import SignalFilters from "@/components/signals/SignalFilters";
import { buildSignalFeedItems } from "@/lib/domain/signals/buildSignalFeedItems";
import type { Signal as ClusterSignal } from "@/lib/domain/signals/clusterSignals";
import type {
  SignalFilters as SignalFiltersType,
  SignalRow,
} from "@/lib/domain/signals/signals";

type SignalsFeedClientProps = {
  initialSignals: SignalRow[];
  initialFilters: SignalFiltersType;
  initialWatchedTickers: string[];
};

type SignalRowWithDates = Omit<SignalRow, "tradeDate" | "filingDate" | "signalDate"> & {
  tradeDate: Date | null;
  filingDate: Date | null;
  signalDate: Date;
};

type FeedSignal = ClusterSignal & {
  row: SignalRowWithDates;
  signalId: number;
};

function toDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toFeedSignal(row: SignalRow): FeedSignal {
  const tradeDate = toDate(row.tradeDate) ?? toDate(row.filingDate) ?? toDate(row.signalDate);

  if (!tradeDate) {
    throw new Error(`Signal ${row.signalId} is missing all date fields`);
  }

  return {
    signalId: row.signalId,
    ticker: row.ticker,
    politician: row.politicianName,
    tradeType: row.tradeType,
    tradeDate,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
    row: {
      ...row,
      tradeDate: toDate(row.tradeDate),
      filingDate: toDate(row.filingDate),
      signalDate: toDate(row.signalDate) ?? tradeDate,
    },
  };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDaysAgo(date: Date) {
  const deltaMs = Date.now() - date.getTime();
  const dayCount = Math.max(0, Math.floor(deltaMs / (24 * 60 * 60 * 1000)));

  if (dayCount === 0) return "today";
  if (dayCount === 1) return "1 day ago";
  return `${dayCount} days ago`;
}

export default function SignalsFeedClient({
  initialSignals,
  initialFilters,
  initialWatchedTickers,
}: SignalsFeedClientProps) {
  const [signals, setSignals] = useState<SignalRow[]>(initialSignals);
  const [isLoading, setIsLoading] = useState(false);
  const watchedTickerSet = new Set(initialWatchedTickers);

  const feedItems = useMemo(() => {
    const normalized = signals.map(toFeedSignal);
    return buildSignalFeedItems(normalized);
  }, [signals]);

  return (
    <>
      <div className="mb-4">
        <SignalFilters
          initialFilters={initialFilters}
          onResultsChange={setSignals}
          onLoadingChange={setIsLoading}
        />

        <div className="mt-2 min-h-5">
          {isLoading ? (
            <p className="text-sm font-medium text-gray-500">Updating results...</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3.5">
        {feedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            No results.
          </div>
        ) : (
          feedItems.map((item) => {
            if (item.type === "single") {
              const signal = item.signal.row;

              return (
                <SignalCard
                  key={`single-${item.signal.signalId}`}
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
                  initialIsWatchingTicker={watchedTickerSet.has(signal.ticker)}
                />
              );
            }

            const newestSignal = item.cluster.signals[item.cluster.signals.length - 1];

            return (
              <article
                key={`cluster-${item.cluster.ticker}-${item.cluster.politician}-${item.cluster.lastTradeDate.toISOString()}`}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-700 ring-1 ring-inset ring-gray-200">
                        Cluster · {item.cluster.count} trades
                      </span>
                      <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700 ring-1 ring-inset ring-gray-200">
                        {item.cluster.dominantTradeType}
                      </span>
                      <span className="text-xs font-medium text-gray-500">
                        Latest {formatDate(item.cluster.lastTradeDate)} ({formatDaysAgo(item.cluster.lastTradeDate)})
                      </span>
                    </div>
                    <p className="text-base font-semibold text-gray-950">{item.summary.headline}</p>
                    <p className="mt-1 text-sm text-gray-600">{item.summary.subheadline}</p>
                  </div>

                  <Link
                    href={`/tickers/${item.cluster.ticker}`}
                    className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold tracking-wide text-gray-900 transition hover:bg-gray-200"
                  >
                    {item.cluster.ticker}
                  </Link>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/signals/${newestSignal.signalId}`}
                    className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
                  >
                    View latest disclosure
                  </Link>
                  <Link
                    href={`/politicians/${newestSignal.row.politicianId}`}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    View politician
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
