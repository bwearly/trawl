import Link from "next/link";
import WatchlistContent from "@/components/watchlist/WatchlistContent";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

export default async function WatchlistPage() {
  const data = await getWatchlist(DEMO_USER_ID);

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
          </div>

          <Link
            href="/signals"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back to signals
          </Link>
        </div>

        <WatchlistContent
          initialPoliticians={data.politicians}
          initialTickers={data.tickers}
        />
      </div>
    </main>
  );
}
