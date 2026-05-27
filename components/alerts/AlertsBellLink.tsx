"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type UnreadAlertsResponse = {
  unreadCount: number;
};

export default function AlertsBellLink() {
  const { data: session, status } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    let active = true;

    void fetch("/api/alerts/unread-count", {
      method: "GET",
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch unread alerts count");
        }

        return response.json() as Promise<UnreadAlertsResponse>;
      })
      .then((data) => {
        if (!active) return;
        setUnreadCount(Number.isFinite(data.unreadCount) ? data.unreadCount : 0);
      })
      .catch(() => {
        if (!active) return;
        setUnreadCount(0);
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  if (status === "loading" || !session?.user?.id) {
    return null;
  }

  return (
    <Link
      href="/alerts"
      className="soft-hover soft-focus relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 hover:text-gray-900"
      aria-label={`Alerts${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      title="Alerts"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h11" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>

      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-semibold leading-none text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
