import {
  getSignals,
  parseSignalFilters,
  parseSignalSort,
} from "@/lib/domain/signals/signals";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const sort = parseSignalSort(searchParams.get("sort") ?? undefined);

  const filters = parseSignalFilters({
    minScore: searchParams.get("minScore") ?? undefined,
    tradeType: searchParams.get("tradeType") ?? undefined,
    party: searchParams.get("party") ?? undefined,
    chamber: searchParams.get("chamber") ?? undefined,
    ticker: searchParams.get("ticker") ?? undefined,
    politician: searchParams.get("politician") ?? undefined,
    freshness: searchParams.get("freshness") ?? undefined,
    sort,
    assetCoverage: searchParams.get("assetCoverage") ?? undefined,
  });

  const rows = await getSignals(filters);

  return Response.json(rows);
}
