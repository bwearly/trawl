"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  assetName: string | null;
  disclosureCount: number;
  lastTradeDate: string | null;
  href: string;
  type: "ticker";
};

type SearchSignalResult = {
  id: number;
  ticker: string;
  politicianName: string;
  score: string;
  primaryReason: string | null;
  signalDate: string;
  href: string;
  type: "signal";
};

type SearchResponse = {
  politicians: SearchPoliticianResult[];
  tickers: SearchTickerResult[];
  signals: SearchSignalResult[];
};

type FlatSearchResult =
  | SearchPoliticianResult
  | SearchTickerResult
  | SearchSignalResult;

type GlobalSearchProps = {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  enableShortcut?: boolean;
};

const emptyResults: SearchResponse = {
  politicians: [],
  tickers: [],
  signals: [],
};

function toTitleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getResultLabel(result: FlatSearchResult) {
  if (result.type === "politician") return result.fullName;
  if (result.type === "ticker") return result.ticker;
  return `${result.ticker} signal`;
}

function getResultDescription(result: FlatSearchResult) {
  if (result.type === "politician") {
    return [toTitleCase(result.chamber), result.party, result.state]
      .filter(Boolean)
      .join(" · ");
  }

  if (result.type === "ticker") {
    const assetName = result.assetName ?? "Ticker activity";
    return `${assetName} · ${result.disclosureCount} disclosure${
      result.disclosureCount === 1 ? "" : "s"
    }`;
  }

  return `${result.politicianName} · score ${result.score}`;
}

function resultTypeLabel(type: FlatSearchResult["type"]) {
  if (type === "politician") return "Politician";
  if (type === "ticker") return "Ticker";
  return "Signal";
}

export default function GlobalSearch({
  variant = "desktop",
  onNavigate,
  enableShortcut = variant === "desktop",
}: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>(emptyResults);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const flatResults = useMemo<FlatSearchResult[]>(
    () => [...results.politicians, ...results.tickers, ...results.signals],
    [results]
  );

  const trimmedQuery = query.trim();
  const hasSearched = trimmedQuery.length >= 2;

  useEffect(() => {
    if (!enableShortcut) return;

    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [enableShortcut]);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 25);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (trimmedQuery.length < 2) {
      queueMicrotask(() => {
        setResults(emptyResults);
        setIsLoading(false);
        setError(null);
        setActiveIndex(0);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmedQuery)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error(`Search failed with ${response.status}`);
        }

        const payload = (await response.json()) as SearchResponse;
        setResults({
          politicians: payload.politicians ?? [],
          tickers: payload.tickers ?? [],
          signals: payload.signals ?? [],
        });
        setActiveIndex(0);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setError("Search is temporarily unavailable. Try again in a moment.");
          setResults(emptyResults);
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, trimmedQuery]);

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setResults(emptyResults);
    setActiveIndex(0);
  }

  function navigateTo(result: FlatSearchResult) {
    closeSearch();
    onNavigate?.();
    router.push(result.href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" && flatResults.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % flatResults.length);
      return;
    }

    if (event.key === "ArrowUp" && flatResults.length > 0) {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + flatResults.length) % flatResults.length
      );
      return;
    }

    if (event.key === "Enter" && flatResults.length > 0) {
      event.preventDefault();
      navigateTo(flatResults[activeIndex] ?? flatResults[0]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`soft-hover soft-focus inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 ${
          variant === "mobile" ? "w-full justify-between px-4 py-3" : "px-3 py-2"
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true">⌕</span>
          <span>{variant === "mobile" ? "Search Trawl" : "Search"}</span>
        </span>
        <span className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:inline">
          ⌘K
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-gray-950/35 px-4 pt-20 backdrop-blur-[2px] sm:pt-24"
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            className="animate-fade-up w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="border-b border-gray-100 p-3">
              <label className="sr-only" htmlFor="global-search-input">
                Search politicians, tickers, and signals
              </label>
              <input
                id="global-search-input"
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search politicians, tickers, or signals..."
                className="soft-focus w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-950 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white"
              />
            </div>

            <div className="max-h-[min(32rem,65vh)] overflow-y-auto p-2">
              {trimmedQuery.length < 2 ? (
                <div className="px-4 py-8 text-sm text-gray-500">
                  Type at least two characters to find a politician, ticker, or
                  research signal.
                </div>
              ) : isLoading ? (
                <div className="px-4 py-8 text-sm text-gray-500">
                  Searching...
                </div>
              ) : error ? (
                <div className="px-4 py-8 text-sm text-rose-600">{error}</div>
              ) : flatResults.length === 0 && hasSearched ? (
                <div className="px-4 py-8 text-sm text-gray-500">
                  No results found.
                </div>
              ) : (
                <div className="space-y-1">
                  {flatResults.map((result, index) => {
                    const active = index === activeIndex;

                    return (
                      <Link
                        key={`${result.type}-${result.href}`}
                        href={result.href}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          closeSearch();
                          onNavigate?.();
                        }}
                        className={`interactive-card soft-focus block rounded-2xl px-4 py-3 transition ${
                          active ? "bg-gray-100" : "soft-hover hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-gray-950">
                              {getResultLabel(result)}
                            </div>
                            <div className="mt-1 text-sm text-gray-500">
                              {getResultDescription(result)}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white">
                            {resultTypeLabel(result.type)}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
              <span>↑↓ choose · Enter open · Esc close</span>
              <button
                type="button"
                onClick={closeSearch}
                className="soft-hover soft-focus rounded-full px-2 py-1 font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-950"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
