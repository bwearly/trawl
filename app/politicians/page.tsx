import { getPoliticianLeaderboard } from "@/lib/domain/politicians/get-politicians-leaderboard";
import Link from "next/link";


function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value}%`;
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

export default async function PoliticiansLeaderboardPage() {
  const rows = await getPoliticianLeaderboard();

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Ranked politician analytics
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Politician Leaderboard
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Ranked by average 30-day alpha, then win rate, then disclosure volume.
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
                Historical outperformance
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Compare politicians by post-disclosure alpha, win rate, and activity.
              </p>
            </div>

            <div className="text-sm text-gray-500">
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
                  <th className="px-4 py-3 font-medium">Avg 30d alpha</th>
                  <th className="px-4 py-3 font-medium">30d win rate</th>
                  <th className="px-4 py-3 font-medium">Avg filing lag</th>
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
                        Buy: {row.purchaseCount} · Sell: {row.saleCount}
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
                      {row.avgFilingLagDays !== null
                        ? `${row.avgFilingLagDays}d`
                        : "—"}
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
                      No politician stats are available yet.
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