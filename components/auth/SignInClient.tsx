"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import type { ProductionAuthReadiness } from "@/lib/auth/auth-readiness";

const allowedDevUserIds = ["demo-user", "demo-user-2", "demo-user-3"] as const;
const isGoogleSignInEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

function SignInContent({ productionReadiness }: { productionReadiness: ProductionAuthReadiness }) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/watchlist";
  const isProduction = process.env.NODE_ENV === "production";
  const [userId, setUserId] = useState<string>(allowedDevUserIds[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      userId,
      callbackUrl,
      redirect: false,
    });

    if (!result || result.error) {
      setError("Sign-in failed. Use one of the allowed demo user IDs.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(result.url ?? callbackUrl);
  }

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    await signIn("google", { callbackUrl });
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Authentication</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Sign in to Trawl</h1>
          <p className="mt-3 text-sm text-gray-600">Sign in to save watchlists and receive alerts.</p>

          {isProduction ? (
            isGoogleSignInEnabled ? (
              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Redirecting..." : "Continue with Google"}
                </button>
                <p className="text-xs text-gray-500">Production sign-in is powered by Google OAuth.</p>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">Sign-in is not launch-ready.</p>
                <p className="mt-2">Google OAuth and required auth environment variables are not fully configured for production.</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                  {!productionReadiness.isGoogleClientEnabled && <li>Set NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true.</li>}
                  {!productionReadiness.hasGoogleClientId && <li>Set GOOGLE_CLIENT_ID.</li>}
                  {!productionReadiness.hasGoogleClientSecret && <li>Set GOOGLE_CLIENT_SECRET.</li>}
                  {!productionReadiness.hasAuthSecret && <li>Set AUTH_SECRET.</li>}
                  {!productionReadiness.hasAuthUrl && <li>Set AUTH_URL.</li>}
                  {!productionReadiness.hasNextAuthUrl && <li>Set NEXTAUTH_URL.</li>}
                  {!productionReadiness.hasAuthTrustHost && <li>Set AUTH_TRUST_HOST.</li>}
                </ul>
              </div>
            )
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-gray-700" htmlFor="userId">Demo user ID</label>
              <input id="userId" name="userId" value={userId} onChange={(event) => setUserId(event.target.value)} list="allowed-dev-user-ids" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm outline-none ring-0 transition focus:border-gray-400" placeholder="demo-user" autoComplete="username" />
              <datalist id="allowed-dev-user-ids">{allowedDevUserIds.map((id) => (<option key={id} value={id} />))}</datalist>
              <p className="text-xs text-gray-500">Allowed: {allowedDevUserIds.join(", ")}</p>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button type="submit" disabled={isSubmitting} className="inline-flex w-full items-center justify-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Signing in..." : "Continue"}</button>
            </form>
          )}

          <div className="mt-6">
            <Link href="/signals" className="text-sm font-medium text-gray-600 transition hover:text-gray-900">← Back to signals</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignInClient({ productionReadiness }: { productionReadiness: ProductionAuthReadiness }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-6"><div className="mx-auto max-w-md"><div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"><p className="text-sm font-medium text-gray-500">Authentication</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Sign in to Trawl</h1><p className="mt-3 text-sm text-gray-600">Loading sign-in options...</p></div></div></main>}>
      <SignInContent productionReadiness={productionReadiness} />
    </Suspense>
  );
}
