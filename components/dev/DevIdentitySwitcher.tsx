"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type IdentityResponse = {
  userId: string;
  source: string;
  allowedUserIds: readonly string[];
};

const FALLBACK_USERS = ["demo-user", "demo-user-2", "demo-user-3"] as const;

export default function DevIdentitySwitcher() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>(FALLBACK_USERS[0]);
  const [source, setSource] = useState<string>("fallback");
  const [allowedUserIds, setAllowedUserIds] = useState<readonly string[]>(FALLBACK_USERS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    let isMounted = true;

    async function loadCurrentIdentity() {
      try {
        setIsLoading(true);
        const response = await fetch("/api/dev-auth/current", { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Failed to load current dev user");
        }

        const data = (await response.json()) as IdentityResponse;
        if (!isMounted) return;

        setUserId(data.userId);
        setSource(data.source);
        if (Array.isArray(data.allowedUserIds) && data.allowedUserIds.length > 0) {
          setAllowedUserIds(data.allowedUserIds);
        }
      } catch {
        if (isMounted) {
          setError("Could not load dev user state.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCurrentIdentity();

    return () => {
      isMounted = false;
    };
  }, []);

  async function onSwitch(nextUserId: string) {
    setError(null);
    setIsSwitching(true);

    try {
      const response = await fetch("/api/dev-auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: nextUserId }),
      });

      if (!response.ok) {
        throw new Error("Failed to switch dev user");
      }

      router.refresh();
      window.location.reload();
    } catch {
      setError("Could not switch dev user.");
      setIsSwitching(false);
    }
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div className="ml-auto flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
      <span className="font-medium">Dev user</span>
      <select
        value={userId}
        onChange={(event) => {
          const next = event.target.value;
          setUserId(next);
          onSwitch(next);
        }}
        disabled={isLoading || isSwitching}
        className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        {allowedUserIds.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="text-[11px] text-amber-800/90">{isLoading ? "loading" : source}</span>
      {error && <span className="text-[11px] text-rose-700">{error}</span>}
    </div>
  );
}
