import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  disclosurePerformanceWindows,
  disclosures,
  politicians,
  priceHistory,
  researchSignals,
} from "@/lib/db/schema";
import SignalPriceChart from "./SignalPriceChart";
import SignalStrengthBadge from "@/components/signals/SignalStrengthBadge";
import { getSignalAlertTier } from "@/lib/domain/alerts/get-signal-alert-tier";

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
  const { id } = await params;
  const signalId = Number(id);

  if (!Number.isFinite(signalId)) {
    return <div className="p-6">Invalid signal ID.</div>;
  }

  const result = await db
    .select({
      id: researchSignals.id,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      ticker: disclosures.ticker,
      tradeType: disclosures.tradeType,
      filingLagDays: disclosures.filingLagDays,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      politicianName: politicians.fullName,
      politicianId: politicians.id,

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
    .leftJoin(
      disclosurePerformanceWindows,
      eq(disclosurePerformanceWindows.disclosureId, disclosures.id)
    )
    .where(eq(researchSignals.id, signalId))
    .limit(1);

  const signal = result[0];

  if (!signal) {
    return <div className="p-6">Signal not found.</div>;
  }

  if (!signal.ticker) {
    return <div className="p-6">Ticker not found for this signal.</div>;
  }

  const anchorDate = signal.tradeDate || signal.filingDate || new Date();
  const chartStartDate = addDays(anchorDate, -30);

    const chartRows = await db
    .select({
      ticker: priceHistory.ticker,
      date: priceHistory.date,
      close: priceHistory.close,
    })
    .from(priceHistory)
    .where(
      and(
        gte(priceHistory.date, chartStartDate),
        eq(priceHistory.ticker, signal.ticker)
      )
    )
    .orderBy(asc(priceHistory.date));

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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href="/signals"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back to signals
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/tickers/${signal.ticker}`}
                className="inline-flex rounded-full bg-gray-100 px-3 py-1.5 text-2xl font-semibold tracking-tight text-gray-950 transition hover:bg-gray-200"
              >
                {signal.ticker}
              </Link>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                Signal #{signal.id}
              </span>
              <SignalStrengthBadge tier={alertTier} />
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

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
            <p className="text-sm font-medium text-gray-500">Signal Score</p>
            <p className="mt-1 text-3xl font-semibold text-gray-950">
              {signal.score}
            </p>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-8">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-gray-950">
                  Performance After Disclosure
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Based on market close prices after the trade date.
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
                      <span className="font-medium text-gray-700">Alpha</span>
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
                          : <span className="text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">SPY</span>
                      <span className="font-semibold">
                        {signal.spyReturn30d != null
                          ? formatPercent(signal.spyReturn30d)
                          : <span className="text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span className="font-medium text-gray-700">Alpha</span>
                      <span className="font-semibold">
                        {alpha30d != null
                          ? formatPercent(alpha30d)
                          : <span className="text-gray-400">Data not available yet</span>}
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
                          : <span className="text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">SPY</span>
                      <span className="font-semibold">
                        {signal.spyReturn90d != null
                          ? formatPercent(signal.spyReturn90d)
                          : <span className="text-gray-400">Data not available yet</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                      <span className="font-medium text-gray-700">Alpha</span>
                      <span className="font-semibold">
                        {alpha90d != null
                          ? formatPercent(alpha90d)
                          : <span className="text-gray-400">Data not available yet</span>}
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
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-950">
                Score Breakdown
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                This section can become more detailed as your scoring model gets
                smarter.
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">Current Signal Score</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-950">
                    {signal.score}
                  </p>
                </div>

                <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                  Add score drivers here next:
                  <ul className="mt-2 space-y-1">
                    <li>• Politician historical hit rate</li>
                    <li>• Trade size / conviction weighting</li>
                    <li>• Cluster activity on the ticker</li>
                    <li>• Recent post-disclosure performance</li>
                    <li>• Outperformance vs SPY</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-950">
                Quick Actions
              </h2>

              <div className="mt-5 flex flex-col gap-3">
                <a
                  href="#price-chart"
                  className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  View chart
                </a>

                <Link
                  href="/signals"
                  className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Back to signal list
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
