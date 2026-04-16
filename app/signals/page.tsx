import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import SignalCard from "@/components/signals/SignalCard";
import { db } from "@/lib/db";
import { disclosures, politicians, researchSignals } from "@/lib/db/schema";

type SearchParams = {
  minScore?: string | string[];
  tradeType?: string | string[];
  party?: string | string[];
  sort?: string | string[];
};

type SignalsPageProps = {
  searchParams: Promise<SearchParams>;
};

const MIN_SCORE_OPTIONS = new Set(["0", "50", "70", "80"]);
const TRADE_TYPE_OPTIONS = new Set(["all", "purchase", "sale", "exchange"]);
const PARTY_OPTIONS = new Set(["all", "Democrat", "Republican", "Independent"]);
const SORT_OPTIONS = new Set(["score", "newest"]);

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const params = await searchParams;

  const rawMinScore = firstParam(params.minScore) ?? "0";
  const minScoreValue = MIN_SCORE_OPTIONS.has(rawMinScore) ? rawMinScore : "0";
  const minScore = Number(minScoreValue);

  const rawTradeType = firstParam(params.tradeType) ?? "all";
  const tradeType = TRADE_TYPE_OPTIONS.has(rawTradeType) ? rawTradeType : "all";

  const rawParty = firstParam(params.party) ?? "all";
  const party = PARTY_OPTIONS.has(rawParty) ? rawParty : "all";

  const rawSort = firstParam(params.sort) ?? "score";
  const sort = SORT_OPTIONS.has(rawSort) ? rawSort : "score";

  const filters = [];

  if (minScore > 0) {
    filters.push(gte(researchSignals.score, String(minScore)));
  }

  if (tradeType !== "all") {
    filters.push(eq(disclosures.tradeType, tradeType));
  }

  if (party !== "all") {
    filters.push(eq(politicians.party, party));
  }

  const rows = await db
    .select({
      signalId: researchSignals.id,
      ticker: researchSignals.ticker,
      score: researchSignals.score,
      primaryReason: researchSignals.primaryReason,
      reasonSummary: researchSignals.reasonSummary,
      politicianName: politicians.fullName,
      tradeType: disclosures.tradeType,
      ownerType: disclosures.ownerType,
      amountRangeLabel: disclosures.amountRangeLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      filingLagDays: disclosures.filingLagDays,
      sourceUrl: disclosures.sourceUrl,
      signalDate: researchSignals.signalDate,
    })
    .from(researchSignals)
    .innerJoin(politicians, eq(researchSignals.politicianId, politicians.id))
    .innerJoin(disclosures, eq(researchSignals.disclosureId, disclosures.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      sort === "newest"
        ? desc(researchSignals.signalDate)
        : desc(researchSignals.score)
    );

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Ranked research feed
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Research Signals
            </h1>
          </div>

          <Link
            href="/"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Back home
          </Link>
        </div>

        <form
          method="get"
          action="/signals"
          className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Minimum score
              </span>
              <select
                name="minScore"
                defaultValue={minScoreValue}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="0">All</option>
                <option value="50">50+</option>
                <option value="70">70+</option>
                <option value="80">80+</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Trade type
              </span>
              <select
                name="tradeType"
                defaultValue={tradeType}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="purchase">Purchase</option>
                <option value="sale">Sale</option>
                <option value="exchange">Exchange</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Party
              </span>
              <select
                name="party"
                defaultValue={party}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="Democrat">Democrat</option>
                <option value="Republican">Republican</option>
                <option value="Independent">Independent</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">
                Sort
              </span>
              <select
                name="sort"
                defaultValue={sort}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="score">Highest score</option>
                <option value="newest">Newest signal</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
            >
              Apply filters
            </button>

            <Link
              href="/signals"
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="space-y-5">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
              No signals matched those filters.
            </div>
          ) : (
            rows.map((row) => (
              <SignalCard
                key={row.signalId}
                signalId={row.signalId}
                ticker={row.ticker}
                score={row.score}
                politicianName={row.politicianName}
                tradeType={row.tradeType}
                ownerType={row.ownerType}
                amountRangeLabel={row.amountRangeLabel}
                tradeDate={row.tradeDate}
                filingDate={row.filingDate}
                filingLagDays={row.filingLagDays}
                sourceUrl={row.sourceUrl}
                primaryReason={row.primaryReason}
                reasonSummary={row.reasonSummary}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
}
