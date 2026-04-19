import Link from "next/link";
import WatchlistContent from "@/components/watchlist/WatchlistContent";
import {
  getWatchlistActivity,
  type WatchlistActivityItem,
} from "@/lib/domain/watchlists/get-watchlist-activity";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

function formatRelativeDate(value: Date) {
  const deltaMs = Date.now() - value.getTime();
  const days = Math.max(0, Math.floor(deltaMs / (24 * 60 * 60 * 1000)));

  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function getActivityHref(item: WatchlistActivityItem) {
  if (item.signalId) {
    return `/signals/${item.signalId}`;
  }

  if (item.entityType === "ticker" && item.ticker) {
    return `/tickers/${item.ticker}`;
  }

  if (item.entityType === "politician" && item.politicianId) {
    return `/politicians/${item.politicianId}`;
  }

  return "/watchlist";
}

export default async function WatchlistPage() {
  const [data, activity] = await Promise.all([
    getWatchlist(DEMO_USER_ID),
    getWatchlistActivity(DEMO_USER_ID),
  ]);
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">What changed</h2>
              <p className="mt-1 text-sm text-gray-500">
                Recent watched-name activity worth checking next.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-200">
              {activity.length} updates
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {activity.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No recent watchlist changes yet. New disclosures and alert-eligible signals will show up here.
              </div>
            ) : (
              activity.map((item) => (
                <Link
                  key={`${item.type}-${item.entityType}-${item.entityId}-${item.signalId ?? "none"}`}
                  href={getActivityHref(item)}
                  className="block rounded-xl border border-gray-200 px-4 py-3 transition hover:bg-gray-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-700 ring-1 ring-inset ring-gray-200">
                      {item.entityType === "ticker" ? "Ticker" : "Politician"}
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      {formatRelativeDate(item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{item.headline}</p>
                  <p className="mt-1 text-sm text-gray-600">{item.subheadline}</p>
                </Link>
              ))
            )}
          </div>
        </section>

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
