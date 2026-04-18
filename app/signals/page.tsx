import Link from "next/link";
import SignalsFeedClient from "@/components/signals/SignalsFeedClient";
import { getUnreadAlertsCount } from "@/lib/domain/alerts/alerts";
import {
  getSignals,
  parseSignalFilters,
} from "@/lib/domain/signals/signals";
import { getWatchedTickers } from "@/lib/domain/watchlists/watchlists";

type SearchParams = {
  minScore?: string | string[];
  tradeType?: string | string[];
  party?: string | string[];
  sort?: string | string[];
};

type SignalsPageProps = {
  searchParams: Promise<SearchParams>;
};

const DEMO_USER_ID = "demo-user";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const params = await searchParams;

  const initialFilters = parseSignalFilters({
    minScore: firstParam(params.minScore),
    tradeType: firstParam(params.tradeType),
    party: firstParam(params.party),
    sort: firstParam(params.sort),
  });

  const [rows, unreadAlertsCount, watchedTickers] = await Promise.all([
    getSignals(initialFilters),
    getUnreadAlertsCount(DEMO_USER_ID),
    getWatchedTickers(DEMO_USER_ID),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Ranked research feed</p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Research Signals
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
              <span>Alerts</span>
              {unreadAlertsCount > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-gray-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {unreadAlertsCount}
                </span>
              )}
            </Link>

            <Link
              href="/"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              ← Back home
            </Link>
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
