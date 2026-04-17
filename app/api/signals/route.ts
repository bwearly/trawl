import { getSignals, parseSignalFilters } from "@/lib/domain/signals/signals";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const filters = parseSignalFilters({
    minScore: searchParams.get("minScore") ?? undefined,
    tradeType: searchParams.get("tradeType") ?? undefined,
    party: searchParams.get("party") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
  });

  const rows = await getSignals(filters);

  return Response.json(rows);
}
