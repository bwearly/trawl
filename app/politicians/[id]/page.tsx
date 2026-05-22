import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
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

function toTimestamp(value: Date | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  return new Date(value).getTime();
}

function getDisplayTicker(rawTicker: string | null | undefined) {
  const normalized = (rawTicker ?? "").trim();
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  if (upper === "--" || upper === "—" || upper === "N/A" || upper === "NONE" || upper === "NULL") return null;
  return upper;
}

function getSignalHref(signalId: number) {
  return `/signals/${signalId}`;
}

export default async function PoliticianDetailPage({ params }: PageProps) {
  const identity = await getPersonalizedUserIdentity();
  const { id } = await params;
  const politicianId = Number(id);

  if (!Number.isFinite(politicianId)) {
    notFound();
  }

  const data = await getPoliticianDetail(politicianId);

  if (!data) {
    notFound();
  }
  const initialIsWatching = identity
    ? await isPoliticianWatched(identity.userId, data.politician.id)
    : false;

  const verdict = getVerdict(data.stats.avgAlpha30d, data.stats.winRate30d);
  const avgAlpha30d = formatPercent(data.stats.avgAlpha30d);
  const sortedDisclosures = [...data.recentDisclosures].sort((a, b) => {
    const filingDiff = toTimestamp(b.filingDate) - toTimestamp(a.filingDate);
    if (filingDiff !== 0) return filingDiff;
    const tradeDiff = toTimestamp(b.tradeDate) - toTimestamp(a.tradeDate);
    if (tradeDiff !== 0) return tradeDiff;
    return b.id - a.id;
  });
  const tickerBackedDisclosures = sortedDisclosures.filter(
    (row) => getDisplayTicker(row.ticker) !== null
  );
  const noTickerDisclosures = sortedDisclosures.filter(
    (row) => getDisplayTicker(row.ticker) === null
  );
  const recentSignals = tickerBackedDisclosures.slice(0, 6);
  const historicalSignals = tickerBackedDisclosures.slice(6);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link
              href="/signals"
              className="text-gray-600 transition hover:text-gray-900"
            >
              ← Back to signals
            </Link>
            <Link href="/politicians" className="text-gray-600 transition hover:text-gray-900">
              View disclosure activity table
            </Link>
          </div>

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
              <p className="mt-2 text-sm text-gray-600">
                Historical outcomes for this politician&apos;s disclosed trades.
                Use these metrics as context, not investment advice.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Trawl surfaces public disclosure activity for research. It does not recommend buying or selling securities.
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
                  Average 30d alpha vs SPY
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
            supportingText={`Sample size · Purchase: ${data.stats.purchaseCount} · Sale: ${data.stats.saleCount}`}
          />

          <DetailStatCard
            label="Average 30d alpha"
            value={avgAlpha30d}
            tone={getMetricTone(avgAlpha30d)}
            supportingText={`Alpha is return vs SPY · 7d: ${formatPercent(data.stats.avgAlpha7d)} · 90d: ${formatPercent(
              data.stats.avgAlpha90d
            )}`}
          />

          <DetailStatCard
            label="30d win rate"
            value={formatPercent(data.stats.winRate30d)}
            tone={getWinRateTone(data.stats.winRate30d)}
            supportingText={`% of disclosures with positive alpha · 7d: ${formatPercent(data.stats.winRate7d)} · 90d: ${formatPercent(
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
            supportingText={`Trade date to filing date · Last trade: ${formatDate(data.stats.lastTradeDate)}`}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                  Recent research signals
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Recent signals are shown first so older historical outliers do not dominate the profile.
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
                  <th className="px-4 py-3 font-medium">30d alpha vs SPY</th>
                </tr>
              </thead>
                <tbody>
                  {recentSignals.map((row) => (
                    <tr
                      key={row.id}
                      className="group border-b border-gray-100 transition hover:bg-gray-50 last:border-b-0"
                    >
                      <td className="px-4 py-4">
                        {getDisplayTicker(row.ticker) ? (
                          <Link
                            href={`/tickers/${getDisplayTicker(row.ticker)}`}
                            className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-800 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-200"
                          >
                            {getDisplayTicker(row.ticker)}
                          </Link>
                        ) : (
                          <span className="text-gray-400">No ticker</span>
                        )}
                      </td>

                      <td className="px-4 py-0 text-gray-700">
                        <Link
                          href={getSignalHref(row.id)}
                          className="block px-0 py-4 text-gray-700 transition group-hover:text-gray-900 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          <span className="block max-w-[18rem] truncate" title={row.assetName}>
                            {row.assetName}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {row.assetType || "Unknown asset type"}
                          </span>
                        </Link>
                      </td>

                      <td className="px-4 py-0">
                        <Link
                          href={getSignalHref(row.id)}
                          className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getTradeTypeClasses(
                              row.tradeType
                            )}`}
                          >
                            {row.tradeType ?? "unknown"}
                          </span>
                        </Link>
                      </td>

                      <td className="px-4 py-0 text-gray-700">
                        <Link
                          href={getSignalHref(row.id)}
                          className="block px-0 py-4 text-gray-700 transition group-hover:text-gray-900 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          {formatDate(row.tradeDate)}
                        </Link>
                      </td>

                      <td className="px-4 py-0">
                        <Link
                          href={getSignalHref(row.id)}
                          className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          {row.score !== null ? (
                            <span className="font-semibold text-gray-900">
                              {row.score}
                            </span>
                          ) : (
                            <span className="text-gray-400">Not scored yet</span>
                          )}
                        </Link>
                      </td>

                      <td
                        className={`px-4 py-0 font-semibold ${toneToClass(
                          getPerformanceTone(row.alpha30d)
                        )}`}
                      >
                        <Link
                          href={getSignalHref(row.id)}
                          className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          {formatPercent(row.alpha30d)}
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {recentSignals.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-gray-500"
                      >
                        <p>No ticker-backed research signals yet.</p>
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm font-medium">
                          <Link href="/signals" className="text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">
                            Go to Signals
                          </Link>
                          <Link href="/" className="text-gray-700 underline decoration-gray-300 underline-offset-4 transition hover:text-gray-900">
                            Go to Home
                          </Link>
                        </div>
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

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                Other disclosure activity
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Some disclosures, such as bonds or other non-stock assets, may not have public ticker symbols and are shown for context rather than scored stock research.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Trade type</th>
                  <th className="px-4 py-3 font-medium">Trade date</th>
                  <th className="px-4 py-3 font-medium">Filing date</th>
                  <th className="px-4 py-3 font-medium">Amount range</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody>
                {noTickerDisclosures.map((row) => (
                  <tr key={row.id} className="group border-b border-gray-100 transition hover:bg-gray-50 last:border-b-0">
                    <td className="px-4 py-4 text-gray-700">
                      <span className="block max-w-[18rem] truncate" title={row.assetName}>
                        {row.assetName}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-700">{row.assetType || "Unknown asset type"}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getTradeTypeClasses(row.tradeType)}`}>
                        {row.tradeType ?? "unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-700">{formatDate(row.tradeDate)}</td>
                    <td className="px-4 py-4 text-gray-700">{formatDate(row.filingDate)}</td>
                    <td className="px-4 py-4 text-gray-700">{row.amountRangeLabel || "Not provided"}</td>
                    <td className="px-4 py-4 text-gray-700">{row.ownerType || "Not provided"}</td>
                  </tr>
                ))}
                {noTickerDisclosures.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                      No non-ticker disclosure activity in this view yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                Historical disclosure context
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Older disclosures remain available below for transparency and deeper research context.
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
                  <th className="px-4 py-3 font-medium">30d alpha vs SPY</th>
                </tr>
              </thead>
              <tbody>
                {historicalSignals.map((row) => (
                  <tr key={row.id} className="group border-b border-gray-100 transition hover:bg-gray-50 last:border-b-0">
                    <td className="px-4 py-4">
                      {getDisplayTicker(row.ticker) ? (
                        <Link
                          href={`/tickers/${getDisplayTicker(row.ticker)}`}
                          className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-800 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-200"
                        >
                          {getDisplayTicker(row.ticker)}
                        </Link>
                      ) : (
                        <span className="text-gray-400">No ticker</span>
                      )}
                    </td>
                    <td className="px-4 py-0 text-gray-700">
                      <Link
                        href={getSignalHref(row.id)}
                        className="block px-0 py-4 text-gray-700 transition group-hover:text-gray-900 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        <span className="block max-w-[18rem] truncate" title={row.assetName}>
                          {row.assetName}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {row.assetType || "Unknown asset type"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-0">
                      <Link
                        href={getSignalHref(row.id)}
                        className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${getTradeTypeClasses(row.tradeType)}`}>
                          {row.tradeType ?? "unknown"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-0 text-gray-700">
                      <Link
                        href={getSignalHref(row.id)}
                        className="block px-0 py-4 text-gray-700 transition group-hover:text-gray-900 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        {formatDate(row.tradeDate)}
                      </Link>
                    </td>
                    <td className="px-4 py-0">
                      <Link
                        href={getSignalHref(row.id)}
                        className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        {row.score !== null ? <span className="font-semibold text-gray-900">{row.score}</span> : <span className="text-gray-400">Not scored yet</span>}
                      </Link>
                    </td>
                    <td className={`px-4 py-0 font-semibold ${toneToClass(getPerformanceTone(row.alpha30d))}`}>
                      <Link
                        href={getSignalHref(row.id)}
                        className="block px-0 py-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        {formatPercent(row.alpha30d)}
                      </Link>
                    </td>
                  </tr>
                ))}
                {historicalSignals.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No older disclosures in this view yet.
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
