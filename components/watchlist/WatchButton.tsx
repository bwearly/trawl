"use client";

import Link from "next/link";
import { useState } from "react";

type WatchButtonProps = {
  itemType: "ticker" | "politician";
  ticker?: string;
  politicianId?: number;
  initialIsWatching?: boolean;
  size?: "default" | "sm";
  variant?: "pill" | "ghost";
  onChange?: (isWatching: boolean) => void;
};

export default function WatchButton({
  itemType,
  ticker,
  politicianId,
  initialIsWatching = false,
  size = "default",
  variant = "pill",
  onChange,
}: WatchButtonProps) {
  const [isWatching, setIsWatching] = useState(initialIsWatching);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function toggleWatch() {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const endpoint =
        itemType === "ticker"
          ? "/api/watchlist/ticker"
          : "/api/watchlist/politician";

      const body =
        itemType === "ticker"
          ? { ticker }
          : { politicianId };

      const response = await fetch(endpoint, {
        method: isWatching ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        setErrorMessage("Sign in to save to your watchlist.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to update watchlist: ${response.status}`);
      }

      const nextValue = !isWatching;
      setIsWatching(nextValue);
      onChange?.(nextValue);
    } catch {
      setErrorMessage("Couldn’t update watchlist. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const baseClasses =
    size === "sm"
      ? "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition"
      : "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition";

  const icon = isWatching ? "★" : "☆";

  const label =
    isLoading
      ? "Updating..."
      : isWatching
      ? "Watching"
      : "Watch";

  const toneClasses =
    variant === "ghost"
      ? isWatching
        ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
        : "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
      : isWatching
      ? "bg-gray-900 text-white hover:bg-gray-800"
      : "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleWatch();
        }}
        disabled={isLoading}
        title={isWatching ? "Remove from watchlist" : "Add to watchlist"}
        aria-label={
          isWatching
            ? `Remove ${itemType} from watchlist`
            : `Add ${itemType} to watchlist`
        }
        className={`${baseClasses} ${toneClasses} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span aria-hidden>{icon}</span>
        <span className="ml-1.5">{label}</span>
      </button>
      {isWatching && !isLoading && (
        <span className="text-xs text-gray-500">Remove from watchlist</span>
      )}
      {errorMessage && <span className="text-xs text-rose-600">{errorMessage} <Link href="/api/auth/signin" className="underline">Sign in</Link>.</span>}
    </div>
  );
}
