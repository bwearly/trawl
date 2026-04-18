"use client";

import Link from "next/link";
import WatchButton from "@/components/watchlist/WatchButton";
import SignalConfidenceBadge from "@/components/signals/SignalConfidenceBadge";
import SignalStrengthBadge from "@/components/signals/SignalStrengthBadge";
import { getSignalAlertTier } from "@/lib/domain/alerts/get-signal-alert-tier";

type SignalCardProps = {
  signalId: number;
  ticker: string;
  score: string;
  signalStatus: string;
  politicianId: number;
  politicianName: string;
  tradeType: string;
  ownerType: string;
  amountRangeLabel: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
  filingLagDays: number | null;
  return7d?: string | null;
  return30d?: string | null;
  historicalSampleSize?: number | null;
  sourceUrl: string | null;
  primaryReason: string | null;
  reasonSummary: string | null;
};

function formatDate(date: Date | null) {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
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

  if (value >= 75) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (value >= 50) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

export default function SignalCard({
  signalId,
  ticker,
  score,
  signalStatus,
  politicianId,
  politicianName,
  tradeType,
  ownerType,
  amountRangeLabel,
  tradeDate,
  filingDate,
  filingLagDays,
  return7d,
  return30d,
  historicalSampleSize,
  sourceUrl,
  primaryReason,
  reasonSummary,
}: SignalCardProps) {
  const alertTier = getSignalAlertTier({
    score,
    signalStatus,
    tradeType,
    filingLagDays,
  });

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <Link
            href={`/tickers/${ticker}`}
            className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-base font-semibold tracking-wide text-gray-900 transition hover:bg-gray-200"
          >
            {ticker}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-500">Research signal</p>
            <SignalStrengthBadge tier={alertTier} />
            <SignalConfidenceBadge
              hasReturn7d={return7d != null}
              hasReturn30d={return30d != null}
              historicalSampleSize={historicalSampleSize}
              filingLagDays={filingLagDays}
            />
          </div>
        </div>

        <div
          className={`inline-flex rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ${getScoreStyles(
            score
          )}`}
        >
          Score {Math.round(Number(score))}/100
        </div>
      </div>

      <div className="mt-5 grid gap-x-5 gap-y-2.5 text-sm text-gray-700 md:grid-cols-2">
        <p>
          <span className="font-medium text-gray-500">Reported by</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <Link
            href={`/politicians/${politicianId}`}
            className="font-medium text-gray-900 transition hover:underline"
          >
            {politicianName}
          </Link>
        </p>
        <p>
          <span className="font-medium text-gray-500">Trade type</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{formatTradeType(tradeType)}</span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Amount</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{amountRangeLabel ?? "Unknown"}</span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Owner</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{formatOwnerType(ownerType)}</span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Trade date</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{formatDate(tradeDate)}</span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Filed</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{formatDate(filingDate)}</span>
        </p>
        <p className="md:col-span-2">
          <span className="font-medium text-gray-500">Filing lag</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">
            {filingLagDays !== null ? `${filingLagDays} days` : "Not available"}
          </span>
        </p>
      </div>

      <div className="mt-5 rounded-xl bg-gray-50 p-4 ring-1 ring-inset ring-gray-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Why this is worth researching
        </p>
        <p className="mt-2 text-sm leading-6 text-gray-700">
          {reasonSummary ||
            primaryReason ||
            "Not enough context yet — check the filing details and recent price action."}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Link
          href={`/signals/${signalId}`}
          className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
        >
          View details
        </Link>

        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            View filing
          </a>
        ) : null}

        <button
          type="button"
          className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          View chart
        </button>

        <button
          type="button"
          className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          View news
        </button>

        <div className="ml-auto sm:ml-0">
          <WatchButton itemType="ticker" ticker={ticker} />
        </div>
      </div>
    </article>
  );
}
