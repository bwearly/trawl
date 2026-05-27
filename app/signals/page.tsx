import Link from "next/link";
import type { Metadata } from "next";
import SignalsFeedClient from "@/components/signals/SignalsFeedClient";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
import { getUnreadAlertsCount } from "@/lib/domain/alerts/alerts";
import {
  getSignals,
  parseSignalFilters,
  parseSignalSort,
} from "@/lib/domain/signals/signals";
import { getWatchedTickers } from "@/lib/domain/watchlists/watchlists";

export const metadata: Metadata = {
  title: "Research Signals | Trawl",
  description:
    "Browse ranked congressional trade research signals, filter by freshness and score, and review filing context for public-disclosure research.",
};

type SearchParams = {
  minScore?: string | string[];
  tradeType?: string | string[];
  party?: string | string[];
  chamber?: string | string[];
  ticker?: string | string[];
  politician?: string | string[];
  freshness?: string | string[];
  sort?: string | string[];
};

type SignalsPageProps = {
  searchParams: Promise<SearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const identity = await getPersonalizedUserIdentity();
  const params = await searchParams;

  const sort = parseSignalSort(firstParam(params.sort));

  const initialFilters = parseSignalFilters({
    minScore: firstParam(params.minScore),
    tradeType: firstParam(params.tradeType),
    party: firstParam(params.party),
    chamber: firstParam(params.chamber),
    ticker: firstParam(params.ticker),
    politician: firstParam(params.politician),
    freshness: firstParam(params.freshness),
    sort,
  });

  const [rows, unreadAlertsCount, watchedTickers] = await Promise.all([
    getSignals(initialFilters),
    identity ? getUnreadAlertsCount(identity.userId) : Promise.resolve(0),
    identity ? getWatchedTickers(identity.userId) : Promise.resolve([]),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 space-y-4">
          <div className="w-full">
            <p className="text-sm font-medium text-gray-500">Ranked research feed</p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Research Signals
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Recent research signals are shown first. Historical signals remain
              available for context.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Trawl surfaces public disclosure activity for research. It does not
              recommend buying or selling securities.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Recent signals are shown first so older historical outliers do not dominate the research feed.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Disclosure data may be delayed, incomplete, amended, or unavailable. Users should verify filings from the original source.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Ticker-backed disclosures are prioritized in research feeds. Some disclosures, such as bonds, may not have public ticker symbols.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              ← Back home
            </Link>

            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <Link
                href="/watchlist"
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
              >
                Watchlist
              </Link>

              <Link
                href="/alerts"
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
              >
                <span>Watchlist Notifications</span>
                {unreadAlertsCount > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-gray-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {unreadAlertsCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </div>

        <SignalsFeedClient
          initialSignals={rows}
          initialFilters={initialFilters}
          initialWatchedTickers={watchedTickers}
        />
      </div>
    </main>
  );
}
