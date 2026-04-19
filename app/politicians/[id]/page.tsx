import Link from "next/link";
import { notFound } from "next/navigation";
import { getPoliticianDetail } from "@/lib/domain/politicians/get-politicians-detail";
import WatchButton from "@/components/watchlist/WatchButton";
import { isPoliticianWatched } from "@/lib/domain/watchlists/watchlists";
import {
  DetailStatCard,
  formatDate,
  formatPercent,
  getMetricTone,
  getPerformanceTone,
  getWinRateTone,
  toneToClass,
} from "@/components/analytics/detail-ui";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

function getVerdict(alpha: number | null, winRate: number | null) {
  if (alpha === null || winRate === null) {
    return {
      label: "Insufficient data",
      classes: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
    };
  }

  if (alpha > 2 && winRate > 55) {
    return {
      label: "Strong historical outperformance",
      classes:
        "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    };
  }

  if (alpha > 0 && winRate > 50) {
    return {
      label: "Slight outperformance",
      classes: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
    };
  }

  if (alpha < 0 && winRate < 50) {
    return {
      label: "Underperformance",
      classes: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
    };
  }

  return {
    label: "Mixed results",
    classes: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  };
}

function toTitleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getTradeTypeClasses(tradeType: string | null | undefined) {
  const value = tradeType?.toLowerCase();

  if (value === "purchase") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }

  if (value === "sale") {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }

  if (value === "exchange") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }

  return "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200";
}

export default async function PoliticianDetailPage({ params }: PageProps) {
  const DEMO_USER_ID = "demo-user";
  const { id } = await params;
  const politicianId = Number(id);

  if (!Number.isFinite(politicianId)) {
    notFound();
  }

  const data = await getPoliticianDetail(politicianId);

  if (!data) {
    notFound();
  }
  const initialIsWatching = await isPoliticianWatched(
    DEMO_USER_ID,
    data.politician.id
  );

  const verdict = getVerdict(data.stats.avgAlpha30d, data.stats.winRate30d);
  const avgAlpha30d = formatPercent(data.stats.avgAlpha30d);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/signals"
            className="text-sm font-medium text-gray-600 transition hover:text-gray-900"
          >
            ← Back to signals
          </Link>

          <div className="sm:ml-auto">
            <WatchButton
              itemType="politician"
              politicianId={data.politician.id}
              initialIsWatching={initialIsWatching}
            />
          </div>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-gray-500">
                Politician analytics
              </p>

              <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
                {data.politician.fullName}
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {initialIsWatching && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Watching
                  </span>
                )}
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                  {toTitleCase(data.politician.chamber)}
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                  {data.politician.party ?? "Unknown party"}
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                  {data.politician.state ?? "Unknown state"}
                </span>
              </div>
            </div>

            <div className="grid gap-3 lg:min-w-72">
              <div
                className={`inline-flex w-fit rounded-full px-4 py-1.5 text-sm font-medium ${verdict.classes}`}
              >
                {verdict.label}
              </div>

              <div className="rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-inset ring-gray-200">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Average 30d alpha
                </p>
                <p
                  className={`mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl ${toneToClass(
                    getPerformanceTone(data.stats.avgAlpha30d)
                  )}`}
                >
                  {avgAlpha30d}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailStatCard
            label="Total disclosures"
            value={String(data.stats.totalDisclosures)}
            supportingText={`Purchase: ${data.stats.purchaseCount} · Sale: ${data.stats.saleCount}`}
          />

          <DetailStatCard
            label="Average 30d alpha"
            value={avgAlpha30d}
            tone={getMetricTone(avgAlpha30d)}
            supportingText={`7d: ${formatPercent(data.stats.avgAlpha7d)} · 90d: ${formatPercent(
              data.stats.avgAlpha90d
            )}`}
          />

          <DetailStatCard
            label="30d win rate"
            value={formatPercent(data.stats.winRate30d)}
            tone={getWinRateTone(data.stats.winRate30d)}
            supportingText={`7d: ${formatPercent(data.stats.winRate7d)} · 90d: ${formatPercent(
              data.stats.winRate90d
            )}`}
          />

          <DetailStatCard
            label="Average filing lag"
            value={
              data.stats.avgFilingLagDays !== null
                ? `${data.stats.avgFilingLagDays}d`
                : "Not enough data yet"
            }
            supportingText={`Last trade: ${formatDate(data.stats.lastTradeDate)}`}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                  Recent disclosures
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Latest trades, signal scores, and realized outperformance vs
                  SPY.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 font-medium">Ticker</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Trade type</th>
                    <th className="px-4 py-3 font-medium">Trade date</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">30d alpha</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentDisclosures.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-gray-100 last:border-b-0"
                    >
                      <td className="px-4 py-4">
                        {row.ticker ? (
                          <Link
                            href={`/tickers/${row.ticker}`}
                            className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-800 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-200"
                          >
                            {row.ticker}
                          </Link>
                        ) : (
                          <span className="text-gray-400">Not available</span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-gray-700">
                        <span className="block max-w-[18rem] truncate" title={row.assetName}>
                          {row.assetName}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getTradeTypeClasses(
                            row.tradeType
                          )}`}
                        >
                          {row.tradeType ?? "unknown"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-700">
                        {formatDate(row.tradeDate)}
                      </td>

                      <td className="px-4 py-4">
                        {row.score !== null ? (
                          <span className="font-semibold text-gray-900">
                            {row.score}
                          </span>
                        ) : (
                          <span className="text-gray-400">Not scored yet</span>
                        )}
                      </td>

                      <td
                        className={`px-4 py-4 font-semibold ${toneToClass(
                          getPerformanceTone(row.alpha30d)
                        )}`}
                      >
                        {formatPercent(row.alpha30d)}
                      </td>
                    </tr>
                  ))}

                  {data.recentDisclosures.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-gray-500"
                      >
                        No disclosures found for this politician yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold tracking-tight text-gray-950">
              Summary
            </h2>

            <dl className="mt-4 space-y-3.5 text-sm">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
                <dt className="text-gray-500">Average 7d return</dt>
                <dd className="font-medium text-gray-900">
                  {formatPercent(data.stats.avgReturn7d)}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
                <dt className="text-gray-500">Average 30d return</dt>
                <dd className="font-medium text-gray-900">
                  {formatPercent(data.stats.avgReturn30d)}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
                <dt className="text-gray-500">Average 90d return</dt>
                <dd className="font-medium text-gray-900">
                  {formatPercent(data.stats.avgReturn90d)}
                </dd>
              </div>

              <div className="flex items-start justify-between gap-4">
                <dt className="text-gray-500">Stats last updated</dt>
                <dd className="font-medium text-gray-900">
                  {formatDate(data.stats.updatedAt)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-600 ring-1 ring-inset ring-gray-200">
              This page summarizes realized post-disclosure performance and
              benchmark-relative outperformance using your current signal and
              performance data.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
