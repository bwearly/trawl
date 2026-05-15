"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  SignalFilters as SignalFiltersType,
  SignalRow,
} from "@/lib/domain/signals/signals";

type SignalFiltersProps = {
  initialFilters: SignalFiltersType;
  onResultsChange: (signals: SignalRow[]) => void;
  onLoadingChange: (isLoading: boolean) => void;
};

type SearchPoliticianResult = {
  id: number;
  fullName: string;
  chamber: string;
  party: string | null;
  state: string | null;
  href: string;
  type: "politician";
};

type SearchTickerResult = {
  ticker: string;
  assetName: string;
  disclosureCount: number;
  lastTradeDate: string | null;
  href: string;
  type: "ticker";
};

type SearchResponse = {
  politicians: SearchPoliticianResult[];
  tickers: SearchTickerResult[];
};

function toTitleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function SignalFilters({
  initialFilters,
  onResultsChange,
  onLoadingChange,
}: SignalFiltersProps) {
  const [minScore, setMinScore] = useState(initialFilters.minScore);
  const [tradeType, setTradeType] = useState(initialFilters.tradeType);
  const [party, setParty] = useState(initialFilters.party);
  const [ticker, setTicker] = useState(initialFilters.ticker);
  const [politician, setPolitician] = useState(initialFilters.politician);
  const [draftTicker, setDraftTicker] = useState(initialFilters.ticker);
  const [draftPolitician, setDraftPolitician] = useState(initialFilters.politician);
  const [freshness, setFreshness] = useState(initialFilters.freshness);
  const [sort, setSort] = useState(initialFilters.sort);
  const [isLoading, setIsLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse>({
    politicians: [],
    tickers: [],
  });
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const hasMounted = useRef(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  function applyTextFilters() {
    setTicker(draftTicker.trim());
    setPolitician(draftPolitician.trim());
  }

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    const controller = new AbortController();

    async function fetchSignals() {
      setIsLoading(true);
      onLoadingChange(true);
      setSignalsError(null);

      try {
        const params = new URLSearchParams({
          minScore,
          tradeType,
          party,
          ticker,
          politician,
          freshness,
          sort,
        });

        const response = await fetch(`/api/signals?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch signals: ${response.status}`);
        }

        const rows = (await response.json()) as SignalRow[];
        onResultsChange(rows);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSignalsError(
            "We couldn’t refresh signals right now. Try adjusting a filter or reloading."
          );
        }
      } finally {
        setIsLoading(false);
        onLoadingChange(false);
      }
    }

    fetchSignals();

    return () => {
      controller.abort();
    };
  }, [
    minScore,
    tradeType,
    party,
    ticker,
    politician,
    freshness,
    sort,
    onResultsChange,
    onLoadingChange,
  ]);

  useEffect(() => {
    const trimmed = searchQuery.trim();

    if (trimmed.length < 2) {
      queueMicrotask(() => {
        setSearchResults({
          politicians: [],
          tickers: [],
        });
        setIsSearchLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearchLoading(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          {
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to search: ${response.status}`);
        }

        const results = (await response.json()) as SearchResponse;
        setSearchResults(results);
        setShowSearchResults(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearchError(
            "Search is temporarily unavailable. Try again in a moment."
          );
        }
      } finally {
        setIsSearchLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowSearchResults(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const hasAnySearchResults =
    searchResults.politicians.length > 0 || searchResults.tickers.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="space-y-3.5">
        <div ref={searchContainerRef} className="relative">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Search politicians or tickers
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => {
                if (
                  searchQuery.trim().length >= 2 ||
                  searchResults.politicians.length > 0 ||
                  searchResults.tickers.length > 0
                ) {
                  setShowSearchResults(true);
                }
              }}
              placeholder="Search Pelosi, Crenshaw, NVDA, PLTR..."
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400"
            />
          </label>

          {showSearchResults && searchQuery.trim().length >= 2 && (
            <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
              {isSearchLoading ? (
                <div className="px-4 py-4 text-sm text-gray-500">
                  Searching...
                </div>
              ) : hasAnySearchResults ? (
                <div className="max-h-96 overflow-y-auto">
                  {searchResults.politicians.length > 0 && (
                    <div className="border-b border-gray-100">
                      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Politicians
                      </div>
                      <div className="pb-2">
                        {searchResults.politicians.map((result) => (
                          <Link
                            key={`politician-${result.id}`}
                            href={result.href}
                            onClick={() => setShowSearchResults(false)}
                            className="block px-4 py-3 transition hover:bg-gray-50"
                          >
                            <div className="font-medium text-gray-900">
                              {result.fullName}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {toTitleCase(result.chamber)}
                              {result.party ? ` · ${result.party}` : ""}
                              {result.state ? ` · ${result.state}` : ""}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.tickers.length > 0 && (
                    <div>
                      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Tickers
                      </div>
                      <div className="pb-2">
                        {searchResults.tickers.map((result) => (
                          <Link
                            key={`ticker-${result.ticker}`}
                            href={result.href}
                            onClick={() => setShowSearchResults(false)}
                            className="block px-4 py-3 transition hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-2">
                              <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-gray-800">
                                {result.ticker}
                              </span>
                              <span className="font-medium text-gray-900">
                                {result.assetName}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {result.disclosureCount} disclosure
                              {result.disclosureCount === 1 ? "" : "s"}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-4 py-4 text-sm text-gray-500">
                  No results found.
                </div>
              )}
            </div>
          )}
          {searchError && (
            <p className="mt-2 text-sm text-rose-600">{searchError}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Minimum score
            </span>
            <select
              value={minScore}
              onChange={(event) =>
                setMinScore(event.target.value as SignalFiltersType["minScore"])
              }
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="0">All</option>
              <option value="50">50+</option>
              <option value="70">70+</option>
              <option value="80">80+</option>
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              Score is a research ranking signal, not investment advice.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Ticker contains
            </span>
            <input
              value={draftTicker}
              onChange={(event) => setDraftTicker(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyTextFilters();
                }
              }}
              disabled={isLoading}
              placeholder="e.g. NVDA"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Politician contains
            </span>
            <input
              value={draftPolitician}
              onChange={(event) => setDraftPolitician(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyTextFilters();
                }
              }}
              disabled={isLoading}
              placeholder="e.g. Pelosi"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Filing freshness
            </span>
            <select
              value={freshness}
              onChange={(event) =>
                setFreshness(
                  event.target.value as SignalFiltersType["freshness"]
                )
              }
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="all">All</option>
              <option value="fresh">Fresh</option>
              <option value="normal">Normal</option>
              <option value="delayed">Delayed</option>
              <option value="stale">Stale</option>
              <option value="historical">Historical</option>
              <option value="unknown">Unknown</option>
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              Fresh = recently filed. Historical = older context.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Trade type
            </span>
            <select
              value={tradeType}
              onChange={(event) =>
                setTradeType(
                  event.target.value as SignalFiltersType["tradeType"]
                )
              }
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
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
              value={party}
              onChange={(event) =>
                setParty(event.target.value as SignalFiltersType["party"])
              }
              disabled
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="all">All</option>
              <option value="Democrat">Democrat</option>
              <option value="Republican">Republican</option>
              <option value="Independent">Independent</option>
            </select>
            <span className="mt-1 block text-xs text-gray-500">
              Party filter is temporarily disabled while disclosure-linked party data is backfilled.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Sort
            </span>
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as SignalFiltersType["sort"])
              }
              disabled={isLoading}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="current">Recent research (default)</option>
              <option value="score">Highest score</option>
              <option value="newest">Newest filing</option>
              <option value="filingLagAsc">Filing lag: shortest</option>
              <option value="filingLagDesc">Filing lag: longest</option>
              <option value="freshness">Freshness (fresh → stale)</option>
              <option value="ticker">Ticker (A → Z)</option>
              <option value="politician">Politician (A → Z)</option>
              <option value="tradeType">Trade type (A → Z)</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={applyTextFilters}
            disabled={isLoading}
            className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply filters
          </button>
        </div>
        {signalsError && (
          <p className="text-sm text-rose-600">{signalsError}</p>
        )}
      </div>
    </div>
  );
}
