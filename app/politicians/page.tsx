import {
  ACTIVE_LEADERBOARD_LOOKBACK_DAYS,
  ACTIVE_LEADERBOARD_MIN_DISCLOSURES,
  getPoliticianDisclosureCountForChamber,
  getPoliticianLeaderboard,
} from "@/lib/domain/politicians/get-politicians-leaderboard";
import Link from "next/link";
import type { Metadata } from "next";
import BackButton from "@/components/navigation/BackButton";
type PageProps = {
  searchParams: Promise<{ chamber?: string | string[]; coverage?: string | string[] }>;
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

function getReliabilityLabel(validPerformanceCount: number) {
  if (validPerformanceCount < 5) return "Limited history";
  if (validPerformanceCount < 10) return "Emerging history";
  return "Established history";
}

function getTimelinessLabel(avgFilingLagDays: number | null) {
  if (avgFilingLagDays == null) return "Lag unknown";
  if (avgFilingLagDays > 365) return "Severely delayed filer";
  if (avgFilingLagDays > 180) return "Delayed filer";
  if (avgFilingLagDays > 90) return "Moderately delayed filer";
  return "Timely filer";
}

export default async function PoliticiansLeaderboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const chamberParam = Array.isArray(params.chamber) ? params.chamber[0] : params.chamber;
  const selectedChamber =
    chamberParam === "house" || chamberParam === "senate" ? chamberParam : "all";
  const coverageParam = Array.isArray(params.coverage) ? params.coverage[0] : params.coverage;
  const selectedCoverage = coverageParam === "all-members" ? "all-members" : "active";
  const rows = await getPoliticianLeaderboard(selectedChamber, selectedCoverage);
  const chamberDisclosureCount = await getPoliticianDisclosureCountForChamber(selectedChamber);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
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
            <p className="mt-2 text-xs text-gray-500">
              Rankings are based on historical performance, sample reliability, disclosure volume, and filing timeliness. Recent activity is used only as a tie-breaker.
            </p>
          </div>

          <div className="mt-3">
            <BackButton className="soft-hover soft-focus rounded-full px-2 py-1 text-sm font-medium text-gray-600 transition hover:text-gray-900" fallbackHref="/signals" />
          </div>
        </div>

        <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                  Disclosure activity table
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Sorted by model leaderboard score (historical usefulness), not newest filing date.
                </p>
              </div>

            <div className="text-sm text-gray-500">
              <div className="mb-2">
                <span className="mr-2">Chamber:</span>
                <Link href="/politicians" className="soft-hover soft-focus mr-2 inline-flex rounded-full px-2 py-1 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">All Congress</Link>
                <Link href="/politicians?chamber=house" className="soft-hover soft-focus mr-2 inline-flex rounded-full px-2 py-1 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">House</Link>
                <Link href="/politicians?chamber=senate" className="soft-hover soft-focus inline-flex rounded-full px-2 py-1 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">Senate</Link>
              </div>
              {rows.length} politician{rows.length === 1 ? "" : "s"}
              <div className="mt-2">
                <span className="mr-2">Coverage:</span>
                <Link href={`/politicians${selectedChamber === "all" ? "" : `?chamber=${selectedChamber}`}`} className="soft-hover soft-focus mr-2 inline-flex rounded-full px-2 py-1 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">Members with disclosures</Link>
                <Link href={`/politicians?${selectedChamber === "all" ? "" : `chamber=${selectedChamber}&`}coverage=all-members`} className="soft-hover soft-focus inline-flex rounded-full px-2 py-1 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">All members</Link>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-gray-100 shadow-sm transition duration-300 hover:shadow-md">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50/80 text-left text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Rank</th>
                  <th className="px-4 py-3 font-medium">Politician</th>
                  <th className="px-4 py-3 font-medium">Profile</th>
                  <th className="px-4 py-3 font-medium">Disclosures</th>
                  <th className="px-4 py-3 font-medium">Leaderboard score</th>
                  <th className="px-4 py-3 font-medium">Valid perf count</th>
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
                    className="group border-b border-gray-100 transition duration-200 hover:bg-gray-50/80 last:border-b-0"
                  >
                    <td className="px-4 py-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700 transition duration-200 group-hover:-translate-y-0.5 group-hover:bg-gray-200 group-hover:shadow-sm">
                        {index + 1}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <Link
                        href={`/politicians/${row.id}`}
                        className="soft-focus inline-flex rounded-md font-semibold text-gray-950 transition duration-200 group-hover:translate-x-0.5 hover:text-gray-700 hover:underline"
                      >
                        {row.fullName}
                      </Link>
                    </td>

                    <td className="px-4 py-4 text-gray-700">
                      <div>{toTitleCase(row.chamber)}</div>
                      <div className="mt-1 text-xs text-gray-500">{row.party ?? "—"} · {row.state ?? "—"}</div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="font-semibold text-gray-900">
                        {row.totalDisclosures}
                      {row.totalDisclosures === 0 && (
                        <div className="mt-1 text-xs text-gray-500">No parsed trading disclosures yet.</div>
                      )}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Purchases: {row.purchaseCount} · Sales: {row.saleCount}
                      </div>
                    </td>

                    <td className="px-4 py-4 font-semibold text-gray-900">
                      {row.leaderboardScore.toFixed(2)}
                    </td>

                    <td className="px-4 py-4">
                      <div className="font-semibold text-gray-900">{row.validPerformanceCount}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {getReliabilityLabel(row.validPerformanceCount)}
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
                      <div className="mt-1 text-xs text-gray-500">
                        {getTimelinessLabel(row.avgFilingLagDays)}
                      </div>
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
                          className="soft-hover soft-focus inline-flex rounded-full px-3 py-1.5 text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
                        >
                          Go to Signals
                        </Link>
                        <Link
                          href="/"
                          className="soft-hover soft-focus inline-flex rounded-full px-3 py-1.5 text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900"
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
