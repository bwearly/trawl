"use client";

import Link from "next/link";
import WatchButton from "@/components/watchlist/WatchButton";
import SignalConfidenceBadge from "@/components/signals/SignalConfidenceBadge";
import SignalStrengthBadge from "@/components/signals/SignalStrengthBadge";
import { getSignalAlertTier } from "@/lib/domain/alerts/get-signal-alert-tier";
import { getFilingFreshnessLabel } from "@/lib/domain/signals/filing-freshness";

type SignalCardProps = {
  signalId: number;
  ticker: string | null;
  score: string;
  performanceScore?: string | null;
  signalStage?: string;
  signalStatus: string;
  politicianId: number;
  politicianName: string;
  chamber?: string | null;
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
  initialIsWatchingTicker?: boolean;
  tradeTypeScore?: string | null;
  tradeSizeScore?: string | null;
  filingFreshnessScore?: string | null;
  historicalPoliticianScore?: string | null;
  momentumScore?: string | null;
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
function formatChamber(chamber: string | null | undefined) {
  if (chamber === "house") return "House";
  if (chamber === "senate") return "Senate";
  return "Unknown chamber";
}

function getScoreStyles(score: string) {
  const value = Number(score);

  if (value >= 70) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (value >= 55) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function getFreshnessStyles(label: string) {
  if (label === "Fresh") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (label === "Normal") return "bg-slate-100 text-slate-700 ring-slate-200";
  if (label === "Delayed") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (label === "Stale") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (label === "Historical") return "bg-gray-200 text-gray-700 ring-gray-300";
  return "bg-gray-100 text-gray-700 ring-gray-200";
}
function getDisplayTicker(rawTicker: string | null | undefined) {
  const normalized = (rawTicker ?? "").trim();
  return normalized.length > 0 ? normalized.toUpperCase() : null;
}

function formatComponentScore(value: string | null | undefined) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 10) / 10;
}

export default function SignalCard({
  signalId,
  ticker,
  score,
  signalStatus,
  politicianId,
  politicianName,
  chamber,
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
  tradeTypeScore,
  tradeSizeScore,
  filingFreshnessScore,
  historicalPoliticianScore,
  momentumScore,
  performanceScore = null,
  signalStage = "fresh",
  initialIsWatchingTicker = false,
}: SignalCardProps) {
  const freshnessLabel = getFilingFreshnessLabel(filingLagDays);
  const displayTicker = getDisplayTicker(ticker);
  const freshnessBadgeCopy =
    freshnessLabel === "Historical" ? "Historical / Not actionable" : freshnessLabel;
  const alertTier = getSignalAlertTier({
    score,
    signalStatus,
    tradeType,
    filingLagDays,
  });
  const missingPerformanceData = return7d == null && return30d == null;
  const cautionReasons: string[] = [];
  if (missingPerformanceData) cautionReasons.push("Limited performance history (7d/30d windows unavailable)");
  if (filingLagDays != null && filingLagDays > 90) cautionReasons.push("Stale filing lag reduces actionability");
  if (filingLagDays != null && filingLagDays > 365) cautionReasons.push("Historical disclosure timing");

  const whyReasons = [
    {
      label: "Trade type",
      score: formatComponentScore(tradeTypeScore),
    },
    {
      label: "Trade size",
      score: formatComponentScore(tradeSizeScore),
    },
    {
      label: "Filing freshness",
      score: formatComponentScore(filingFreshnessScore),
    },
    {
      label: "Historical politician context",
      score: formatComponentScore(historicalPoliticianScore),
    },
    {
      label: "Recent momentum context",
      score: formatComponentScore(momentumScore),
    },
  ].filter((item) => item.score != null);

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          {displayTicker ? (
            <Link
              href={`/tickers/${displayTicker}`}
              className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-gray-900 transition hover:bg-gray-200"
            >
              {displayTicker}
            </Link>
          ) : (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-gray-500 ring-1 ring-inset ring-gray-200">
              No ticker
            </span>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs text-gray-500">Research signal</p>
            <SignalStrengthBadge tier={alertTier} />
            <SignalConfidenceBadge
              hasReturn7d={return7d != null}
              hasReturn30d={return30d != null}
              historicalSampleSize={historicalSampleSize}
              filingLagDays={filingLagDays}
            />
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${getFreshnessStyles(
                freshnessLabel
              )}`}
              title="Filing freshness shows how quickly the trade was filed: fresh is recent, stale/historical is older."
              aria-label={`Filing freshness: ${freshnessBadgeCopy}. Fresh means recent filing; delayed, stale, and historical are older.`}
            >
              {freshnessBadgeCopy}
            </span>
          </div>
        </div>

        <div
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${getScoreStyles(
            score
          )}`}
          title="Signal Score ranks forward-looking opportunity quality based on filing context and supporting data. Not investment advice."
          aria-label={`Signal Score ${Math.round(Number(score))} out of 100.`}
        >
          Signal Score {Math.round(Number(score))}/100
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <p>Signal Score ranks research priority (not investment advice).</p>
        <p>
          Performance Score:{" "}
          {performanceScore == null
            ? signalStage === "fresh"
              ? "Pending (fresh signal)"
              : "In progress"
            : `${Math.round(Number(performanceScore))}/100`}
        </p>
      </div>

      <div className="mt-3 grid gap-x-3 gap-y-1.5 text-xs text-gray-700 md:grid-cols-2">
        <p>
          <span className="font-medium text-gray-500">Reported by</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <Link
            href={`/politicians/${politicianId}`}
            className="inline-block max-w-[20rem] truncate align-bottom font-medium text-gray-900 transition hover:underline"
            title={politicianName}
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
          <span className="font-medium text-gray-500">Chamber</span>
          <span className="mx-1.5 text-gray-300">•</span>
          <span className="text-gray-900">{formatChamber(chamber)}</span>
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

      <div className="mt-3 rounded-xl bg-gray-50 p-3 ring-1 ring-inset ring-gray-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Why this is worth researching
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-700">
          {reasonSummary ||
            primaryReason ||
            "Not enough context yet — check the filing details and recent price action."}
        </p>
      </div>

      <details className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-600">
          Why this score?
        </summary>
        <div className="mt-2 space-y-2 text-xs text-gray-700">
          <p>
            <span className="font-medium text-gray-500">Score</span>: {Math.round(Number(score))}/100 ·{" "}
            <span className="font-medium text-gray-500">Stage</span>: {signalStage}
          </p>
          <p>
            <span className="font-medium text-gray-500">Filing lag</span>:{" "}
            {filingLagDays != null ? `${filingLagDays} days` : "Not available"}
          </p>
          <p>
            <span className="font-medium text-gray-500">Performance windows</span>:{" "}
            {missingPerformanceData ? "Missing (limited confidence)" : "Available"}
          </p>
          {whyReasons.length > 0 ? (
            <div>
              <p className="font-medium text-gray-500">Top positive components</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {whyReasons
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .slice(0, 3)
                  .map((item) => (
                    <li key={item.label}>
                      {item.label}: +{item.score?.toFixed(1)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="font-medium text-gray-500">Cautions</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {cautionReasons.length > 0 ? (
                cautionReasons.map((caution) => <li key={caution}>{caution}</li>)
              ) : (
                <li>No major caution flags from filing timeliness/performance availability.</li>
              )}
            </ul>
          </div>
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/signals/${signalId}`}
          className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black"
        >
          View details
        </Link>

        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            View filing
          </a>
        ) : null}

        {displayTicker ? (
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <WatchButton
              itemType="ticker"
              ticker={displayTicker}
              size="sm"
              initialIsWatching={initialIsWatchingTicker}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
