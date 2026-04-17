import Link from "next/link";
import { getAlerts } from "@/lib/domain/alerts/alerts";
import AlertPreferencesForm from "@/components/alerts/AlertPreferencesForm";

const DEMO_USER_ID = "demo-user";

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
  const rows = await getAlerts(DEMO_USER_ID);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">
              Personalized notifications
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950">
              Alerts
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              New signals from watched tickers and watched politicians.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <form action="/api/alerts" method="post">
              <button
                type="submit"
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
              >
                Mark all read
              </button>
            </form>

            <Link
              href="/signals"
              className="text-sm font-medium text-gray-600 transition hover:text-gray-900"
            >
              ← Back to signals
            </Link>
          </div>
        </div>

        <AlertPreferencesForm />

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-950">
                Recent alerts
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Latest matched signals for your watchlist.
              </p>
            </div>

            <div className="text-sm text-gray-500">
              {rows.length} alert{rows.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {rows.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
                No alerts yet. Start watching a few tickers or politicians and
                alerts will show up here.
              </div>
            )}

            {rows.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-2xl border p-4 ${
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

                    {alert.message && (
                      <div className="mt-1 text-sm text-gray-600">
                        {alert.message}
                      </div>
                    )}

                    <div className="mt-3 text-xs text-gray-500">
                      {formatDate(alert.createdAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={getAlertHref(alert)}
                      className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
                    >
                      Open
                    </Link>

                    {!alert.isRead && (
                      <form action={`/api/alerts/${alert.id}`} method="post">
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
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