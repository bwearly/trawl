import Link from "next/link";
import type { Metadata } from "next";
import { getPersonalizedUserIdentity } from "@/lib/auth/get-current-user-id";
import { getAlerts } from "@/lib/domain/alerts/alerts";
import BackButton from "@/components/navigation/BackButton";
import { getTickerDisplayParts } from "@/lib/domain/tickers/displayTicker";

export const metadata: Metadata = {
  title: "Alerts | Trawl",
  description:
    "Review alert events generated from your watchlist and mark them read.",
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function getAlertHref(alert: {
  researchSignalId: number | null;
  politicianId: number | null;
  ticker: string | null;
}) {
  if (alert.researchSignalId) {
    return `/signals/${alert.researchSignalId}`;
  }

  if (alert.politicianId) {
    return `/politicians/${alert.politicianId}`;
  }

  if (alert.ticker) {
    return `/tickers/${alert.ticker}`;
  }

  return "/signals";
}

function getAlertTone(type: string) {
  if (type === "watched_ticker_signal") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (type === "watched_politician_signal") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  return "bg-gray-100 text-gray-700 ring-gray-200";
}

function getAlertTypeLabel(type: string) {
  if (type === "watched_ticker_signal") return "Watched ticker";
  if (type === "watched_politician_signal") return "Watched politician";
  return "Alert";
}

export default async function AlertsPage() {
  const identity = await getPersonalizedUserIdentity();

  if (!identity) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-500">Watchlist alerts</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Sign in to view alerts</h1>
            <p className="mt-3 text-sm text-gray-600">Sign in to review triggered updates from the politicians and tickers you watch.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Link href="/signin?callbackUrl=%2Falerts" className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition soft-hover soft-focus hover:bg-black">Sign in</Link>
              <Link href="/signals" className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50">Browse signals</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const rows = await getAlerts(identity.userId);
  const unreadCount = rows.filter((row) => !row.isRead).length;
  const readCount = rows.length - unreadCount;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Watchlist alerts
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Alerts
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Review triggered watchlist updates and mark them read.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Trawl surfaces disclosure activity for research. It does not recommend buying or selling securities.
            </p>
          </div>

          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <BackButton className="text-sm font-medium text-gray-600 transition soft-hover soft-focus hover:text-gray-900" fallbackHref="/signals" />

            <form action="/api/alerts" method="post" className="inline-flex">
              <button
                type="submit"
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition soft-hover soft-focus hover:bg-gray-50"
              >
                Mark all read
              </button>
            </form>
          </div>
        </div>

        <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-gray-950">Alert preferences</h2>
              <p className="mt-1 text-sm text-gray-600">
                Manage which watchlist alerts are generated in Account settings.
              </p>
            </div>
            <Link
              href="/account#alert-preferences"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-gray-50"
            >
              Go to account settings
            </Link>
          </div>
        </section>

        <section className="animate-fade-up interactive-card rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                Recent watchlist alerts
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Latest matched signals for your watchlist.
              </p>
            </div>

            <div className="text-sm text-gray-500">
              {rows.length} total · {unreadCount} unread · {readCount} read
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {rows.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <h3 className="text-base font-semibold text-gray-900">No watchlist alerts yet</h3>
                <p className="mt-2 text-sm text-gray-600">
                  Add items to your watchlist and tune your preferences to start
                  receiving relevant watchlist alerts.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  <Link
                    href="/signals"
                    className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition soft-hover soft-focus hover:bg-black"
                  >
                    Browse signals
                  </Link>
                  <Link
                    href="/watchlist"
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-white"
                  >
                    Go to watchlist
                  </Link>
                  <Link
                    href="/account#alert-preferences"
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition soft-hover soft-focus hover:bg-white"
                  >
                    Adjust alert preferences
                  </Link>
                </div>
              </div>
            )}

            {rows.map((alert) => (
              <div
                key={alert.id}
                className={`interactive-card rounded-2xl border p-4 ${
                  alert.isRead
                    ? "border-gray-200 bg-white"
                    : "border-gray-300 bg-gray-50"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${getAlertTone(
                          alert.type
                        )}`}
                      >
                        {getAlertTypeLabel(alert.type)}
                      </span>

                      {!alert.isRead && (
                        <span className="inline-flex rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white">
                          New
                        </span>
                      )}
                    </div>

                    <div className="mt-3 text-base font-semibold text-gray-950">
                      {alert.title}
                    </div>

                    {(() => {
                      const tickerDisplay = getTickerDisplayParts({
                        ticker: alert.ticker,
                        assetName: alert.assetName,
                      });

                      return tickerDisplay.secondary ? (
                        <div className="mt-1 text-xs text-gray-500">
                          {tickerDisplay.ticker} · {tickerDisplay.secondary}
                        </div>
                      ) : null;
                    })()}

                    {alert.message && (
                      <div className="mt-1 text-sm text-gray-600">
                        {alert.message}
                      </div>
                    )}

                    <div className="mt-3 text-xs text-gray-500">
                      {formatDate(alert.createdAt)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={getAlertHref(alert)}
                    className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition soft-hover soft-focus hover:bg-gray-50"
                  >
                    Open
                  </Link>

                    {!alert.isRead && (
                      <form action={`/api/alerts/${alert.id}`} method="post">
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition soft-hover soft-focus hover:bg-gray-50"
                        >
                          Mark read
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
