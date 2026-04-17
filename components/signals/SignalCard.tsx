"use client";

import Link from "next/link";
import WatchButton from "@/components/watchlist/WatchButton";

type SignalCardProps = {
  signalId: number;
  ticker: string;
  score: string;
  politicianId: number;
  politicianName: string;
  tradeType: string;
  ownerType: string;
  amountRangeLabel: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
  filingLagDays: number | null;
  sourceUrl: string | null;
  primaryReason: string | null;
  reasonSummary: string | null;
};

function formatDate(date: Date | null) {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTradeType(tradeType: string) {
  return tradeType.charAt(0).toUpperCase() + tradeType.slice(1);
}

function formatOwnerType(ownerType: string) {
  return ownerType.charAt(0).toUpperCase() + ownerType.slice(1);
}

function getScoreStyles(score: string) {
  const value = Number(score);

  if (value >= 75) return "bg-green-100 text-green-800 border-green-200";
  if (value >= 50) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

export default function SignalCard({
  signalId,
  ticker,
  score,
  politicianId,
  politicianName,
  tradeType,
  ownerType,
  amountRangeLabel,
  tradeDate,
  filingDate,
  filingLagDays,
  sourceUrl,
  primaryReason,
  reasonSummary,
}: SignalCardProps) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href={`/tickers/${ticker}`}
            className="inline-flex rounded-full bg-gray-100 px-3 py-1.5 text-lg font-semibold tracking-wide text-gray-900 transition hover:bg-gray-200"
          >
            {ticker}
          </Link>
          <p className="mt-1 text-sm text-gray-500">Research Signal</p>
        </div>

        <div
          className={`rounded-full border px-4 py-2 text-sm font-semibold ${getScoreStyles(
            score
          )}`}
        >
          {Math.round(Number(score))}/100
        </div>
      </div>

      <div className="mt-6 grid gap-3 text-sm text-gray-800 md:grid-cols-2">
        <p>
          <span className="font-semibold text-gray-900">Reported by:</span>{" "}
            <Link
              href={`/politicians/${politicianId}`}
              className="cursor-pointer hover:underline"
            >
              {politicianName}
            </Link>
        </p>
        <p>
          <span className="font-semibold text-gray-900">Trade type:</span>{" "}
          {formatTradeType(tradeType)}
        </p>
        <p>
          <span className="font-semibold text-gray-900">Amount:</span>{" "}
          {amountRangeLabel ?? "Unknown"}
        </p>
        <p>
          <span className="font-semibold text-gray-900">Owner:</span>{" "}
          {formatOwnerType(ownerType)}
        </p>
        <p>
          <span className="font-semibold text-gray-900">Trade date:</span>{" "}
          {formatDate(tradeDate)}
        </p>
        <p>
          <span className="font-semibold text-gray-900">Filed:</span>{" "}
          {formatDate(filingDate)}
        </p>
        <p className="md:col-span-2">
          <span className="font-semibold text-gray-900">Filing lag:</span>{" "}
          {filingLagDays ?? "Unknown"} days
        </p>
      </div>

      <div className="mt-6 rounded-xl bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-950">
          Why this is worth researching
        </p>
        <p className="mt-2 text-sm leading-6 text-blue-900">
          {reasonSummary || primaryReason || "No explanation available yet."}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/signals/${signalId}`}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          View details
        </Link>

        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View filing
          </a>
        ) : null}

        <button
          type="button"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View chart
        </button>

        <button
          type="button"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View news
        </button>

        <WatchButton itemType="ticker" ticker={ticker} />
      </div>
    </article>
  );
}
