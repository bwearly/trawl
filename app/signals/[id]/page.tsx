import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";

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

  if (value >= 75) {
    return "bg-green-100 text-green-800 border-green-200";
  }

  if (value >= 50) {
    return "bg-yellow-100 text-yellow-800 border-yellow-200";
  }

  return "bg-red-100 text-red-800 border-red-200";
}

type SignalDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SignalDetailPage({
  params,
}: SignalDetailPageProps) {
  const { id } = await params;
  const signalId = Number(id);

  if (Number.isNaN(signalId)) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-white p-8">
          <h1 className="text-2xl font-bold text-red-700">Invalid signal ID</h1>
        </div>
      </main>
    );
  }

  const rows = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      signalStatus: researchSignals.signalStatus,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      tradeTypeScore: researchSignals.tradeTypeScore,
      tradeSizeScore: researchSignals.tradeSizeScore,
      filingFreshnessScore: researchSignals.filingFreshnessScore,
      historicalPoliticianScore: researchSignals.historicalPoliticianScore,
      momentumScore: researchSignals.momentumScore,
      committeeRelevanceScore: researchSignals.committeeRelevanceScore,
      clusterScore: researchSignals.clusterScore,
      userRelevanceScore: researchSignals.userRelevanceScore,

      politicianName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,

      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountRangeLabel: disclosures.amountRangeLabel,
      assetName: disclosures.assetName,
      assetType: disclosures.assetType,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      sourceUrl: disclosures.sourceUrl,
      sourceLabel: disclosures.sourceLabel,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(eq(researchSignals.id, signalId));

  const signal = rows[0];

  if (!signal) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-gray-200 bg-white p-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Signal not found
          </h1>
          <p className="mt-2 text-gray-600">
            We could not find a research signal with that ID.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
          >
            Back to signals
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Link
            href="/"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back to signals
          </Link>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-950">
                {signal.ticker}
              </h1>
              <p className="mt-1 text-lg text-gray-600">{signal.assetName}</p>
              <p className="mt-2 text-sm text-gray-500">Research Signal</p>
            </div>

            <div
              className={`rounded-full border px-5 py-2 text-base font-semibold ${getScoreStyles(
                signal.score
              )}`}
            >
              {Math.round(Number(signal.score))}/100
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="space-y-3 rounded-xl bg-gray-50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Disclosure Details
              </h2>
              <p>
                <span className="font-semibold text-gray-900">Reported by:</span>{" "}
                {signal.politicianName}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Trade type:</span>{" "}
                {formatTradeType(signal.tradeType)}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Amount:</span>{" "}
                {signal.amountRangeLabel ?? "Unknown"}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Owner:</span>{" "}
                {formatOwnerType(signal.ownerType)}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Asset type:</span>{" "}
                {signal.assetType}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Trade date:</span>{" "}
                {formatDate(signal.tradeDate)}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Filed:</span>{" "}
                {formatDate(signal.filingDate)}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Filing lag:</span>{" "}
                {signal.filingLagDays ?? "Unknown"} days
              </p>
            </div>

            <div className="space-y-3 rounded-xl bg-gray-50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Politician Context
              </h2>
              <p>
                <span className="font-semibold text-gray-900">Name:</span>{" "}
                {signal.politicianName}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Chamber:</span>{" "}
                {signal.chamber}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Party:</span>{" "}
                {signal.party ?? "Unknown"}
              </p>
              <p>
                <span className="font-semibold text-gray-900">State:</span>{" "}
                {signal.state ?? "Unknown"}
              </p>
              <p>
                <span className="font-semibold text-gray-900">Signal status:</span>{" "}
                {signal.signalStatus}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-blue-50 p-5">
            <h2 className="text-lg font-semibold text-blue-950">
              Why this is worth researching
            </h2>
            <p className="mt-3 leading-7 text-blue-900">
              {signal.reasonSummary ||
                signal.primaryReason ||
                "No explanation available yet."}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">
            Score Breakdown
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Trade Type</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.tradeTypeScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Trade Size</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.tradeSizeScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Filing Freshness</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.filingFreshnessScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Historical Politician Score</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.historicalPoliticianScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Momentum</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.momentumScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Committee Relevance</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.committeeRelevanceScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Cluster Activity</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.clusterScore ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">User Relevance</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {signal.userRelevanceScore ?? "—"}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Next Steps</h2>

          <div className="mt-5 flex flex-wrap gap-3">
            {signal.sourceUrl ? (
              <a
                href={signal.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
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

            <button
              type="button"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Add to watchlist
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}