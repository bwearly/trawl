import Link from "next/link";
import type { Metadata } from "next";
import WatchlistContent from "@/components/watchlist/WatchlistContent";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
import {
  getWatchlistActivity,
  type WatchlistActivityItem,
} from "@/lib/domain/watchlists/get-watchlist-activity";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";
import { eq } from "drizzle-orm";

export const metadata: Metadata = {
  title: "Watchlist | Trawl",
  description:
    "Track saved politicians and tickers, monitor recent activity, and jump back into high-priority disclosures.",
};

function formatRelativeDate(value: Date) {
  const deltaMs = Date.now() - value.getTime();
  const days = Math.max(0, Math.floor(deltaMs / (24 * 60 * 60 * 1000)));

  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}


const MAX_WHAT_CHANGED_ITEMS = 8;
const MAX_HISTORY_ITEMS = 12;

function formatAbsoluteDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
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
  const identity = await getPersonalizedUserIdentity();

  if (!identity) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-500">Personalized tracking</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Sign in to use your watchlist</h1>
            <p className="mt-3 text-sm text-gray-600">Sign in to save politicians and tickers to your watchlist.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Link href="/signin?callbackUrl=%2Fwatchlist" className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black">Sign in</Link>
              <Link href="/signals" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Browse signals</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const [data, activity, userRecord] = await Promise.all([
    getWatchlist(identity.userId),
    getWatchlistActivity(identity.userId),
    db.select({ lastSignInAt: users.lastSignInAt }).from(users).where(eq(users.id, identity.userId)).limit(1),
  ]);
  const totalWatched = data.politicians.length + data.tickers.length;
  const lastSignInAt = userRecord[0]?.lastSignInAt ?? null;
  const newSinceLastSignIn =
    lastSignInAt == null
      ? []
      : activity.filter((item) => item.createdAt.getTime() > lastSignInAt.getTime());
  const whatChangedItems = (lastSignInAt == null ? activity : newSinceLastSignIn).slice(0, MAX_WHAT_CHANGED_ITEMS);
  const historyItems = activity.slice(0, MAX_HISTORY_ITEMS);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-3">
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
                : "Track politicians and tickers in one place, then use research notifications to stay on top of new activity."}
            </p>
            <p className="mt-2 text-xs text-gray-500">Trawl surfaces disclosure activity for research. It does not recommend buying or selling securities.</p>
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
                {lastSignInAt
                  ? `New watched activity since your last sign-in (${formatAbsoluteDate(lastSignInAt)}).`
                  : "Recent watched-name activity from the last 21 days."}
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-200">
              {whatChangedItems.length} updates
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {whatChangedItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                {lastSignInAt
                  ? "No new watchlist activity since your last sign-in. You’re all caught up."
                  : "No recent watchlist changes yet. New disclosures and high-ranked signals will show up here."}
              </div>
            ) : (
              whatChangedItems.map((item) => (
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">History</h2>
              <p className="mt-1 text-sm text-gray-500">
                Earlier watchlist activity from the last 21 days.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-200">
              {historyItems.length} items
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {historyItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No watchlist history yet.
              </div>
            ) : (
              historyItems.map((item) => (
                <Link
                  key={`history-${item.type}-${item.entityType}-${item.entityId}-${item.signalId ?? "none"}`}
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
              Review watchlist notifications
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
