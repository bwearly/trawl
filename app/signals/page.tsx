import Link from "next/link";
import SignalsFeedClient from "@/components/signals/SignalsFeedClient";
import {
  getSignals,
  parseSignalFilters,
} from "@/lib/signals";

type SearchParams = {
  minScore?: string | string[];
  tradeType?: string | string[];
  party?: string | string[];
  sort?: string | string[];
};

type SignalsPageProps = {
  searchParams: Promise<SearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const params = await searchParams;

  const initialFilters = parseSignalFilters({
    minScore: firstParam(params.minScore),
    tradeType: firstParam(params.tradeType),
    party: firstParam(params.party),
    sort: firstParam(params.sort),
  });

  const rows = await getSignals(initialFilters);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Ranked research feed</p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Research Signals
            </h1>
          </div>

          <Link href="/" className="text-sm font-medium text-gray-600 hover:text-gray-900">
            ← Back home
          </Link>
        </div>

        <SignalsFeedClient initialSignals={rows} initialFilters={initialFilters} />
      </div>
    </main>
  );
}
