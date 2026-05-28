import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicianStats,
  politicians,
  priceHistory,
  researchSignals,
} from "@/lib/db/schema";
import SignalPriceChart from "./SignalPriceChart";
import BackButton from "@/components/navigation/BackButton";
import SignalConfidenceBadge from "@/components/signals/SignalConfidenceBadge";
import { getSignalDisplayLabel, getSignalDisplayScore } from "@/lib/domain/scoring/displayScore";
import SignalStrengthBadge from "@/components/signals/SignalStrengthBadge";
import WatchButton from "@/components/watchlist/WatchButton";
import { getSignalAlertTier } from "@/lib/domain/alerts/get-signal-alert-tier";
import { getSignalConfidenceTier } from "@/lib/domain/signals/get-signal-confidence-tier";
import { getSignalTakeaways } from "@/lib/domain/signals/get-signal-takeaways";
import { getTickerDisplayParts } from "@/lib/domain/tickers/displayTicker";
import {
  isTickerWatched,
} from "@/lib/domain/watchlists/watchlists";

function formatCurrency(value: string | null) {
  if (value == null) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function formatPercent(value: string | null) {
  if (value == null) return "—";

  const numericValue = Number(value);

  const colorClass =
    numericValue > 0
      ? "text-green-700"
      : numericValue < 0
      ? "text-red-700"
      : "text-gray-900";

  return (
    <span className={colorClass}>
      {numericValue > 0 ? "+" : ""}
      {numericValue.toFixed(2)}%
    </span>
  );
}

function calcRelativeReturn(
  stockValue: string | null,
  benchmarkValue: string | null
) {
  if (stockValue == null || benchmarkValue == null) return null;
  return (Number(stockValue) - Number(benchmarkValue)).toFixed(2);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export default async function SignalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await getPersonalizedUserIdentity();
  const { id } = await params;
  const signalId = Number(id);

  if (!Number.isFinite(signalId)) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">
              Invalid signal link
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              This signal URL appears to be incomplete or malformed.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/signals"
                className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition soft-hover soft-focus hover:bg-black"
              >
                Back to signals
              </Link>
              <Link
                href="/"
                className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
              >
                Go home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const result = await db
    .select({
      id: researchSignals.id,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      ticker: disclosures.ticker,
      assetName: disclosures.assetName,
      tradeType: disclosures.tradeType,
      filingLagDays: disclosures.filingLagDays,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      amountRangeLabel: disclosures.amountRangeLabel,
      sourceUrl: disclosures.sourceUrl,
      politicianName: politicians.fullName,
      politicianId: politicians.id,
      chamber: politicians.chamber,
      historicalSampleSize: politicianStats.totalDisclosures,
      historicalPoliticianScore: researchSignals.historicalPoliticianScore,
      tradeTypeScore: researchSignals.tradeTypeScore,
      tradeSizeScore: researchSignals.tradeSizeScore,
      filingFreshnessScore: researchSignals.filingFreshnessScore,
      momentumScore: researchSignals.momentumScore,
      clusterScore: researchSignals.clusterScore,
      userRelevanceScore: researchSignals.userRelevanceScore,
      reasonSummary: researchSignals.reasonSummary,

      tradeDatePrice: disclosurePerformanceWindows.tradeDatePrice,
      filingDatePrice: disclosurePerformanceWindows.filingDatePrice,
      return7d: disclosurePerformanceWindows.return7d,
      return30d: disclosurePerformanceWindows.return30d,
      return90d: disclosurePerformanceWindows.return90d,
      spyReturn7d: disclosurePerformanceWindows.spyReturn7d,
      spyReturn30d: disclosurePerformanceWindows.spyReturn30d,
      spyReturn90d: disclosurePerformanceWindows.spyReturn90d,
    })
    .from(researchSignals)
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .innerJoin(politicians, eq(disclosures.politicianId, politicians.id))
    .leftJoin(politicianStats, eq(politicianStats.politicianId, politicians.id))
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .where(eq(researchSignals.id, signalId))
    .limit(1);

  const signal = result[0];

  if (!signal) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">
              Signal not found
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              This signal may have been removed, or the link may be out of date.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/signals"
                className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition soft-hover soft-focus hover:bg-black"
              >
                Browse signals
              </Link>
              <Link
                href="/"
                className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
              >
                Go home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const tickerDisplay = getTickerDisplayParts({
    ticker: signal.ticker,
    assetName: signal.assetName,
  });
  const normalizedTicker = tickerDisplay.ticker;

  const anchorDate = signal.tradeDate || signal.filingDate || new Date();
  const chartStartDate = addDays(anchorDate, -30);

  const chartRows = normalizedTicker
    ? await db
        .select({
          ticker: priceHistory.ticker,
          date: priceHistory.date,
          close: priceHistory.close,
        })
        .from(priceHistory)
        .where(
          and(
            gte(priceHistory.date, chartStartDate),
            eq(priceHistory.ticker, normalizedTicker)
          )
        )
        .orderBy(asc(priceHistory.date))
    : [];

  const spyRows = await db
    .select({
      date: priceHistory.date,
      close: priceHistory.close,
    })
    .from(priceHistory)
    .where(
      and(gte(priceHistory.date, chartStartDate), eq(priceHistory.ticker, "SPY"))
    )
    .orderBy(asc(priceHistory.date));

  const spyMap = new Map(
    spyRows.map((row) => [
      row.date.toISOString().slice(0, 10),
      Number(row.close),
    ])
  );

  const tradeDateString = signal.tradeDate
    ? signal.tradeDate.toISOString().slice(0, 10)
    : null;

  const filingDateString = signal.filingDate
    ? signal.filingDate.toISOString().slice(0, 10)
    : null;

  const stockBase = chartRows.length > 0 ? Number(chartRows[0].close) : null;

  const firstSpyRowForRange = spyRows.find((row) => row.close != null);
  const spyBase = firstSpyRowForRange ? Number(firstSpyRowForRange.close) : null;

  const chartData = chartRows.map((row) => {
    const rowDateString = row.date.toISOString().slice(0, 10);
    const stockClose = Number(row.close);
    const spyClose = spyMap.get(rowDateString) ?? null;

    const normalizedClose =
      stockBase != null && stockBase !== 0
        ? Number(((stockClose / stockBase) * 100).toFixed(2))
        : 100;

    const normalizedSpyClose =
      spyClose != null && spyBase != null && spyBase !== 0
        ? Number(((spyClose / spyBase) * 100).toFixed(2))
        : null;

    return {
      date: rowDateString,
      close: stockClose,
      spyClose,
      normalizedClose,
      normalizedSpyClose,
      isTradeDate: tradeDateString === rowDateString,
      isFilingDate: filingDateString === rowDateString,
    };
  });

  const alpha7d = calcRelativeReturn(signal.return7d, signal.spyReturn7d);
  const alpha30d = calcRelativeReturn(signal.return30d, signal.spyReturn30d);
  const alpha90d = calcRelativeReturn(signal.return90d, signal.spyReturn90d);
  const alertTier = getSignalAlertTier({
    score: signal.score,
    signalStatus: signal.signalStatus,
    tradeType: signal.tradeType,
    filingLagDays: signal.filingLagDays,
  });
  const displayScore = getSignalDisplayScore({
    rawScore: signal.score,
    filingLagDays: signal.filingLagDays,
    filingDate: signal.filingDate,
    ticker: normalizedTicker,
    signalStatus: signal.signalStatus,
    hasReturn7d: signal.return7d != null,
    hasReturn30d: signal.return30d != null,
  });
  const displayLabel = getSignalDisplayLabel(displayScore);
  const confidence = getSignalConfidenceTier({
    hasReturn7d: signal.return7d != null,
    hasReturn30d: signal.return30d != null,
    historicalSampleSize: signal.historicalSampleSize,
    filingLagDays: signal.filingLagDays,
  });
  const takeaways = getSignalTakeaways({
    tradeType: signal.tradeType,
    score: signal.score,
    alertTier,
    confidenceTier: confidence.tier,
    filingLagDays: signal.filingLagDays,
    alpha7d,
    alpha30d,
    alpha90d,
    historicalSampleSize: signal.historicalSampleSize,
    amountRangeLabel: signal.amountRangeLabel,
    tradeSizeScore: signal.tradeSizeScore,
    historicalPoliticianScore: signal.historicalPoliticianScore,
  });
  const [initialIsWatchingTicker] = identity
    ? await Promise.all([
      normalizedTicker
        ? isTickerWatched(identity.userId, normalizedTicker)
        : Promise.resolve(false),
      ])
    : [false];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <BackButton
            fallbackHref="/signals"
            className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back
          </BackButton>
        </div>

        <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              {normalizedTicker ? (
                <div className="flex max-w-full flex-col items-start gap-1">
                  <Link
                    href={`/tickers/${normalizedTicker}`}
                    className="inline-flex rounded-full bg-gray-100 px-3 py-1.5 text-2xl font-semibold tracking-tight text-gray-950 transition soft-hover soft-focus hover:bg-gray-200"
                  >
                    {normalizedTicker}
                  </Link>
                  {tickerDisplay.secondary ? (
                    <p className="max-w-xl text-sm leading-5 text-gray-500">
                      {tickerDisplay.secondary}
                    </p>
                  ) : null}
                </div>
              ) : tickerDisplay.primary ? (
                <span className="inline-flex max-w-xl rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-200">
                  {tickerDisplay.primary}
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
                  Ticker unavailable
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                Signal #{signal.id}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                {signal.chamber === "senate" ? "Senate" : "House"}
              </span>
              <SignalStrengthBadge tier={alertTier} />
              <SignalConfidenceBadge
                hasReturn7d={signal.return7d != null}
                hasReturn30d={signal.return30d != null}
                historicalSampleSize={signal.historicalSampleSize}
                filingLagDays={signal.filingLagDays}
              />
            </div>

            <p className="text-base text-gray-600">
              Trade linked to <Link href={`/politicians/${signal.politicianId}`}>
              <span className="font-medium hover:underline">
                {signal.politicianName}
              </span>
            </Link>
            </p>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
              <span>
                Trade date:{" "}
                {signal.tradeDate
                  ? signal.tradeDate.toLocaleDateString()
                  : "—"}
              </span>
              <span>
                Filing date:{" "}
                {signal.filingDate
                  ? signal.filingDate.toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
              <p className="text-sm font-medium text-gray-500">Research Priority Score</p>
              <p className="mt-1 text-3xl font-semibold text-gray-950">
                {displayScore}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {displayLabel} · Calibrated for research triage, not investment advice.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {normalizedTicker ? (
                <WatchButton
                  itemType="ticker"
                  ticker={normalizedTicker}
                  size="sm"
                  initialIsWatching={initialIsWatchingTicker}
                />
              ) : null}
            </div>
          </div>
        </div>

        <section className="animate-fade-up interactive-card mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-950">
            Key signal takeaways
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {takeaways.map((takeaway) => (
              <div
                key={takeaway}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              >
                {takeaway}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-8">
            <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-gray-950">
                  Performance After Disclosure
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Based on market close prices after the trade date. Alpha means
                  performance versus SPY over the same window.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Trade Date Price</p>
                  <p className="mt-2 text-lg font-semibold text-gray-950">
                    {formatCurrency(signal.tradeDatePrice)}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Filing Date Price</p>
                  <p className="mt-2 text-lg font-semibold text-gray-950">
                    {formatCurrency(signal.filingDatePrice)}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">7 Day Return</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Stock</span>
                      <span className="font-semibold">
                        {formatPercent(signal.return7d)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">SPY</span>
                      <span className="font-semibold">
                        {formatPercent(signal.spyReturn7d)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span
                        className="font-medium text-gray-700"
                        title="Alpha means stock performance compared with SPY over the same period."
                      >
                        Alpha
                      </span>
                      <span className="font-semibold">
                        {alpha7d != null
                          ? formatPercent(alpha7d)
                          : "Data not available yet"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">30 Day Return</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Stock</span>
                      <span className="font-semibold">
                        {signal.return30d != null
                          ? formatPercent(signal.return30d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">SPY</span>
                      <span className="font-semibold">
                        {signal.spyReturn30d != null
                          ? formatPercent(signal.spyReturn30d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span
                        className="font-medium text-gray-700"
                        title="Alpha means stock performance compared with SPY over the same period."
                      >
                        Alpha
                      </span>
                      <span className="font-semibold">
                        {alpha30d != null
                          ? formatPercent(alpha30d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">90 Day Return</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Stock</span>
                      <span className="font-semibold">
                        {signal.return90d != null
                          ? formatPercent(signal.return90d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">SPY</span>
                      <span className="font-semibold">
                        {signal.spyReturn90d != null
                          ? formatPercent(signal.spyReturn90d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span
                        className="font-medium text-gray-700"
                        title="Alpha means stock performance compared with SPY over the same period."
                      >
                        Alpha
                      </span>
                      <span className="font-semibold">
                        {alpha90d != null
                          ? formatPercent(alpha90d)
                          : <span className="text-xs font-medium leading-tight text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Benchmark</p>
                  <p className="mt-2 text-lg font-semibold text-gray-950">SPY</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Relative performance is measured against SPDR S&amp;P 500
                    ETF.
                  </p>
                </div>
              </div>

              <div id="price-chart" className="mt-8">
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-gray-950">
                    Recent Price Action
                  </h3>
                  <p className="text-sm text-gray-500">
                    Relative performance vs SPY, indexed to 100 at the first visible date.
                  </p>
                </div>

                <SignalPriceChart data={chartData} />
              </div>
            </section>
          </div>

          <div className="space-y-8">
            <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-950">
                Score Breakdown
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Priority Score is a calibrated view of model output, filing context, and confidence for ranking research follow-up.
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Current Priority Score</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-950">
                    {displayScore}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {displayLabel} · Calibrated research-priority score, not investment advice.
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Raw model score: {signal.score}</p>
                </div>

                <details className="group rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 transition duration-200 hover:border-gray-300 hover:bg-white hover:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-gray-900">
                    <span>Why this score?</span>
                    <span className="text-gray-400 transition group-open:rotate-180">⌄</span>
                  </summary>

                  <div className="mt-4 space-y-4 border-t border-gray-200 pt-4">
                    <p className="text-sm text-gray-600">
                      This score ranks research priority based on trade type, disclosure size,
                      filing timeliness, politician history, market context, and watchlist relevance.
                    </p>

                    <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Trade type</p>
                        <p className="mt-1">{signal.tradeTypeScore ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Trade size</p>
                        <p className="mt-1">{signal.tradeSizeScore ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Filing timeliness</p>
                        <p className="mt-1">{signal.filingFreshnessScore ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Politician history</p>
                        <p className="mt-1">{signal.historicalPoliticianScore ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Momentum</p>
                        <p className="mt-1">{signal.momentumScore ?? "—"}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="font-semibold text-gray-900">Cluster / watchlist context</p>
                        <p className="mt-1">
                          Cluster {signal.clusterScore ?? "—"} · Watchlist {signal.userRelevanceScore ?? "—"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
                      <p>
                        Filing lag: {signal.filingLagDays ?? "unknown"} day{signal.filingLagDays === 1 ? "" : "s"}.
                        Historical sample: {signal.historicalSampleSize ?? "not enough data yet"} disclosure{signal.historicalSampleSize === 1 ? "" : "s"}.
                      </p>
                      <p className="mt-1">
                        Performance windows: 7d {signal.return7d != null ? "available" : "pending"}, 30d {signal.return30d != null ? "available" : "pending"}.
                      </p>
                    </div>
                  </div>
                </details>
              </div>
            </section>

            <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-950">
                Quick Actions
              </h2>

              <div className="mt-5 flex flex-col gap-3">
                <a
                  href="#price-chart"
                  className="cursor-pointer rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
                >
                  View chart
                </a>

                {signal.sourceUrl ? (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
                  >
                    View filing
                  </a>
                ) : null}

                <BackButton
                  fallbackHref="/signals"
                  className="cursor-pointer rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
                >
                  ← Back
                </BackButton>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
