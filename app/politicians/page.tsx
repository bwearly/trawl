import {
  ACTIVE_LEADERBOARD_LOOKBACK_DAYS,
  ACTIVE_LEADERBOARD_MIN_DISCLOSURES,
  getPoliticianDisclosureCountForChamber,
  getPoliticianLeaderboard,
} from "@/lib/domain/politicians/get-politicians-leaderboard";
import Link from "next/link";
import type { Metadata } from "next";
type PageProps = {
  searchParams: Promise<{ chamber?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Congressional Disclosure Activity | Trawl",
  description:
    "Review congressional disclosure activity with historical context and chamber filters to guide further research.",
};


function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value}%`;
}

function formatDays(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value)}d`;
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function toTitleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
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

export default async function PoliticiansLeaderboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const chamberParam = Array.isArray(params.chamber) ? params.chamber[0] : params.chamber;
  const selectedChamber =
    chamberParam === "house" || chamberParam === "senate" ? chamberParam : "all";
  const rows = await getPoliticianLeaderboard(selectedChamber);
  const chamberDisclosureCount = await getPoliticianDisclosureCountForChamber(selectedChamber);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Active disclosure analytics
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Congressional disclosure activity
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Compare recent disclosure activity with historical post-filing outcomes for research prioritization.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Showing politicians with at least {ACTIVE_LEADERBOARD_MIN_DISCLOSURES} disclosures in the last 12 months.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Active window uses a {ACTIVE_LEADERBOARD_LOOKBACK_DAYS}-day lookback on filing/trade dates.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Alpha = return relative to SPY. Win rate = share of disclosures with
              positive alpha.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Trawl surfaces public disclosure activity for research. It does not recommend buying or selling securities.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signals"
              className="text-sm font-medium text-gray-600 transition hover:text-gray-900"
            >
              ← Back to signals
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                  Disclosure activity table
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Sorted by active disclosure context: 30-day alpha, then win rate, then total sample size.
                </p>
              </div>

            <div className="text-sm text-gray-500">
              <div className="mb-2">
                <span className="mr-2">Chamber:</span>
                <Link href="/politicians" className="mr-2 underline">All Congress</Link>
                <Link href="/politicians?chamber=house" className="mr-2 underline">House</Link>
                <Link href="/politicians?chamber=senate" className="underline">Senate</Link>
              </div>
              {rows.length} politician{rows.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Rank</th>
                  <th className="px-4 py-3 font-medium">Politician</th>
                  <th className="px-4 py-3 font-medium">Chamber</th>
                  <th className="px-4 py-3 font-medium">Party</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Disclosures</th>
                  <th className="px-4 py-3 font-medium">Avg 30d alpha vs SPY</th>
                  <th className="px-4 py-3 font-medium">30d win rate</th>
                  <th className="px-4 py-3 font-medium">Avg filing lag (days)</th>
                  <th className="px-4 py-3 font-medium">Last trade</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 last:border-b-0"
                  >
                    <td className="px-4 py-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                        {index + 1}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <Link
                        href={`/politicians/${row.id}`}
                        className="font-semibold text-gray-950 transition hover:text-gray-700 hover:underline"
                      >
                        {row.fullName}
                      </Link>
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      {toTitleCase(row.chamber)}
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      {row.party ?? "—"}
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      {row.state ?? "—"}
                    </td>

                    <td className="px-4 py-4">
                      <div className="font-semibold text-gray-900">
                        {row.totalDisclosures}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Purchases: {row.purchaseCount} · Sales: {row.saleCount}
                      </div>
                    </td>

                    <td
                      className={`px-4 py-4 font-semibold ${getAlphaTone(
                        row.avgAlpha30d
                      )}`}
                    >
                      {formatPercent(row.avgAlpha30d)}
                    </td>

                    <td
                      className={`px-4 py-4 font-semibold ${getWinRateTone(
                        row.winRate30d
                      )}`}
                    >
                      {formatPercent(row.winRate30d)}
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      {formatDays(row.avgFilingLagDays)}
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      {formatDate(row.lastTradeDate)}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-10 text-center text-sm text-gray-500"
                    >
                      <p>
                        {chamberDisclosureCount > 0
                          ? `Disclosure activity exists${selectedChamber === "all" ? "" : ` for ${selectedChamber === "house" ? "House" : "Senate"}`}, but no rows currently satisfy the active table threshold.`
                          : `No politician stats are available yet${selectedChamber === "all" ? "." : ` for ${selectedChamber === "house" ? "House" : "Senate"}.`}`}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm font-medium">
                        <Link
                          href="/signals"
                          className="text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
                        >
                          Go to Signals
                        </Link>
                        <Link
                          href="/"
                          className="text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
                        >
                          Go to Home
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
