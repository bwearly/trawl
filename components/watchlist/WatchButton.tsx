"use client";

import { useState } from "react";

type WatchButtonProps = {
  itemType: "ticker" | "politician";
  ticker?: string;
  politicianId?: number;
  initialIsWatching?: boolean;
  size?: "default" | "sm";
  onChange?: (isWatching: boolean) => void;
};

export default function WatchButton({
  itemType,
  ticker,
  politicianId,
  initialIsWatching = false,
  size = "default",
  onChange,
}: WatchButtonProps) {
  const [isWatching, setIsWatching] = useState(initialIsWatching);
  const [isLoading, setIsLoading] = useState(false);

  async function toggleWatch() {
    if (isLoading) return;

    setIsLoading(true);

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

      if (!response.ok) {
        throw new Error(`Failed to update watchlist: ${response.status}`);
      }

      const nextValue = !isWatching;
      setIsWatching(nextValue);
      onChange?.(nextValue);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  const baseClasses =
    size === "sm"
      ? "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition"
      : "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleWatch();
      }}
      disabled={isLoading}
      className={`${baseClasses} ${
        isWatching
          ? "bg-gray-900 text-white hover:bg-gray-800"
          : "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {isLoading ? "Updating..." : isWatching ? "Watching" : "Watch"}
    </button>
  );
}