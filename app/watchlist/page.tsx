import Link from "next/link";
import WatchButton from "@/components/watchlist/WatchButton";
import { getWatchlist } from "@/lib/domain/watchlists/watchlists";

const DEMO_USER_ID = "demo-user";

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function getAlphaTone(value: number | null) {
  if (value === null) return "text-gray-900";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-rose-600";
  return "text-gray-900";
}

function getWinRateTone(value: number | null) {
  if (value === null) return "text-gray-900";
  if (value >= 55) return "text-emerald-600";
  if (value < 50) return "text-rose-600";
  return "text-amber-600";
}

function WatchlistPoliticiansSection({
  politicians,
}: {
  politicians: {
    id: number;
    fullName: string;
    chamber: string;
    party: string | null;
    state: string | null;
    totalDisclosures: number;
    avgAlpha30d: number | null;
    winRate30d: number | null;
    lastTradeDate: Date | null;
  }[];
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-950">Watched Politicians</h2>

      <div className="mt-4 space-y-3">
        {politicians.length === 0 && (
          <div className="text-sm text-gray-500">No politicians added yet.</div>
        )}

        {politicians.map((p) => (
          <Link
            key={p.id}
            href={`/politicians/${p.id}`}
            className="flex flex-col gap-4 rounded-xl border border-gray-200 p-4 transition hover:bg-gray-50 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <div className="font-semibold text-gray-900">{p.fullName}</div>
              <div className="text-xs text-gray-500">
                {p.party ?? "Unknown"}
                {p.state ? ` · ${p.state}` : ""}
              </div>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-gray-500">Alpha</div>
                  <div className={getAlphaTone(p.avgAlpha30d)}>
                    {formatPercent(p.avgAlpha30d)}
                  </div>
                </div>

                <div>
                  <div className="text-gray-500">Win rate</div>
                  <div className={getWinRateTone(p.winRate30d)}>
                    {formatPercent(p.winRate30d)}
                  </div>
                </div>

                <div>
                  <div className="text-gray-500">Last trade</div>
                  <div>{formatDate(p.lastTradeDate)}</div>
                </div>
              </div>

              <WatchButton
                itemType="politician"
                politicianId={p.id}
                initialIsWatching
                size="sm"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function WatchlistTickersSection({
  tickers,
}: {
  tickers: {
    ticker: string;
    assetName: string;
    disclosureCount: number;
    lastTradeDate: Date | null;
  }[];
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-950">Watched Tickers</h2>

      <div className="mt-4 space-y-3">
        {tickers.length === 0 && (
          <div className="text-sm text-gray-500">No tickers added yet.</div>
        )}

        {tickers.map((t) => (
          <Link
            key={t.ticker}
            href={`/tickers/${t.ticker}`}
            className="flex flex-col gap-4 rounded-xl border border-gray-200 p-4 transition hover:bg-gray-50 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <div className="font-semibold text-gray-900">{t.ticker}</div>
              <div className="text-xs text-gray-500">{t.assetName}</div>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-gray-500">Disclosures</div>
                  <div>{t.disclosureCount}</div>
                </div>

                <div>
                  <div className="text-gray-500">Last trade</div>
                  <div>{formatDate(t.lastTradeDate)}</div>
                </div>
              </div>

              <WatchButton
                itemType="ticker"
                ticker={t.ticker}
                initialIsWatching
                size="sm"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

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

        <WatchlistPoliticiansSection politicians={data.politicians} />
        <WatchlistTickersSection tickers={data.tickers} />
      </div>
    </main>
  );
}