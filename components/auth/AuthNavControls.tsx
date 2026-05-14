"use client";

import { signOut, useSession } from "next-auth/react";

export default function AuthNavControls() {
  const { data: session, status } = useSession();

  if (process.env.NODE_ENV === "production" && !session?.user?.id) {
    return null;
  }

  if (status === "loading") {
    return <span className="text-xs text-gray-500">Auth…</span>;
  }

  const displayName = session?.user?.name || session?.user?.email || session?.user?.id || "Signed in";

  if (session?.user?.id) {
    return (
      <button type="button" onClick={() => signOut()} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100">
        Sign out ({displayName})
      </button>
    );
  }

  return (
    <button type="button" onClick={() => window.location.assign("/signin")} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100">
      Sign in
    </button>
  );
}
