import Link from "next/link";
import WatchlistContent from "@/components/watchlist/WatchlistContent";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

export default async function WatchlistPage() {
  const data = await getWatchlist(DEMO_USER_ID);
  const totalWatched = data.politicians.length + data.tickers.length;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Personalized tracking
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              My Watchlist
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {totalWatched > 0
                ? `${totalWatched} saved item${totalWatched === 1 ? "" : "s"} across tickers and politicians.`
                : "Nothing saved yet — add items from signals, ticker pages, or politician pages."}
            </p>
          </div>

          <Link
            href="/signals"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back to signals
          </Link>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/signals"
              className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
            >
              Browse signals
            </Link>
            <Link
              href="/alerts"
              className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Review watchlist alerts
            </Link>
          </div>
        </section>

        <WatchlistContent
          initialPoliticians={data.politicians}
          initialTickers={data.tickers}
        />
      </div>
    </main>
  );
}
