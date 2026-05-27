import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
import AlertPreferencesForm from "@/components/alerts/AlertPreferencesForm";

export const metadata: Metadata = {
  title: "Account | Trawl",
  description: "Manage your Trawl account, watchlist, and notification settings.",
};

export default async function AccountPage() {
  const [identity, session] = await Promise.all([getPersonalizedUserIdentity(), auth()]);

  if (!identity || !session?.user?.id) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-500">Account</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Sign in to view your account</h1>
            <p className="mt-3 text-sm text-gray-600">Sign in to view your account, watchlist, and notification settings.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Link href="/signin?callbackUrl=%2Faccount" className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black">Sign in</Link>
              <Link href="/signals" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Browse signals</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const displayName = session.user.name || session.user.email || "Signed in";

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition duration-200 hover:shadow-md">
          <p className="text-sm font-medium text-gray-500">Account</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">{displayName}</h1>
          <p className="mt-2 text-sm text-gray-600">Your account powers personalized watchlists, research notifications, and preference settings in Trawl.</p>

          <div className="mt-5 flex items-start gap-4">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="Profile" className="h-14 w-14 rounded-full border border-gray-200 object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-sm font-semibold text-gray-600">
                {(displayName[0] ?? "U").toUpperCase()}
              </div>
            )}

            <dl className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Name</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900">{session.user.name || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Email</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900">{session.user.email || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Technical account ID</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-700">{session.user.id}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition duration-200 hover:shadow-md">
          <h2 className="text-lg font-semibold text-gray-950">Quick links</h2>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link href="/watchlist" className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black">Watchlist</Link>
            <Link href="/alerts" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Alerts</Link>
            <Link href="#alert-preferences" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Alert preferences</Link>
            <Link href="/signals" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">Signals</Link>
          </div>
        </section>

        <AlertPreferencesForm />
      </div>
    </main>
  );
}
