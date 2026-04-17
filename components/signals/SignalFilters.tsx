"use client";

import { useEffect, useRef, useState } from "react";
import type { SignalFilters as SignalFiltersType, SignalRow } from "@/lib/signals";

type SignalFiltersProps = {
  initialFilters: SignalFiltersType;
  onResultsChange: (signals: SignalRow[]) => void;
  onLoadingChange: (isLoading: boolean) => void;
};

export default function SignalFilters({
  initialFilters,
  onResultsChange,
  onLoadingChange,
}: SignalFiltersProps) {
  const [minScore, setMinScore] = useState(initialFilters.minScore);
  const [tradeType, setTradeType] = useState(initialFilters.tradeType);
  const [party, setParty] = useState(initialFilters.party);
  const [sort, setSort] = useState(initialFilters.sort);
  const [isLoading, setIsLoading] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    const controller = new AbortController();

    async function fetchSignals() {
      setIsLoading(true);
      onLoadingChange(true);

      try {
        const params = new URLSearchParams({
          minScore,
          tradeType,
          party,
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
          console.error(error);
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
  }, [minScore, tradeType, party, sort, onResultsChange, onLoadingChange]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
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
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700">
            Trade type
          </span>
          <select
            value={tradeType}
            onChange={(event) =>
              setTradeType(event.target.value as SignalFiltersType["tradeType"])
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
            disabled={isLoading}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
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
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as SignalFiltersType["sort"])
            }
            disabled={isLoading}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="score">Highest score</option>
            <option value="newest">Newest signal</option>
          </select>
        </label>
      </div>
    </div>
  );
}