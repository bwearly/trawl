"use client";

import { useEffect, useState } from "react";

type AlertPreferences = {
  id: number;
  userId: string;
  minScore: number;
  enableWatchedTickerAlerts: boolean;
  enableWatchedPoliticianAlerts: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export default function AlertPreferencesForm() {
  const [preferences, setPreferences] = useState<AlertPreferences | null>(null);
  const [minScore, setMinScore] = useState("0");
  const [enableWatchedTickerAlerts, setEnableWatchedTickerAlerts] =
    useState(true);
  const [enableWatchedPoliticianAlerts, setEnableWatchedPoliticianAlerts] =
    useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPreferences() {
      setIsLoading(true);
      setMessage(null);

      try {
        const response = await fetch("/api/alerts/preferences");

        if (!response.ok) {
          throw new Error(`Failed to load preferences: ${response.status}`);
        }

        const data = (await response.json()) as AlertPreferences;

        if (!isMounted) return;

        setPreferences(data);
        setMinScore(String(data.minScore ?? 0));
        setEnableWatchedTickerAlerts(data.enableWatchedTickerAlerts);
        setEnableWatchedPoliticianAlerts(data.enableWatchedPoliticianAlerts);
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setMessage("Could not load alert preferences.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadPreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/alerts/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          minScore: Number(minScore),
          enableWatchedTickerAlerts,
          enableWatchedPoliticianAlerts,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save preferences: ${response.status}`);
      }

      const updated = (await response.json()) as AlertPreferences;
      setPreferences(updated);
      setMinScore(String(updated.minScore ?? 0));
      setEnableWatchedTickerAlerts(updated.enableWatchedTickerAlerts);
      setEnableWatchedPoliticianAlerts(updated.enableWatchedPoliticianAlerts);
      setMessage("Preferences saved.");
    } catch (error) {
      console.error(error);
      setMessage("Could not save preferences.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-gray-950">
          Alert Preferences
        </h2>
        <p className="text-sm text-gray-500">
          Control which watchlist alerts you receive and how strong a signal
          must be before it appears.
        </p>
      </div>

      {isLoading ? (
        <div className="mt-5 text-sm text-gray-500">Loading preferences...</div>
      ) : (
        <form onSubmit={handleSave} className="mt-5 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Minimum score threshold
            </span>
            <select
              value={minScore}
              onChange={(event) => setMinScore(event.target.value)}
              disabled={isSaving}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="0">All alerts</option>
              <option value="50">50+</option>
              <option value="70">70+</option>
              <option value="80">80+</option>
            </select>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={enableWatchedTickerAlerts}
              onChange={(event) =>
                setEnableWatchedTickerAlerts(event.target.checked)
              }
              disabled={isSaving}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">
                Watched ticker alerts
              </div>
              <div className="text-sm text-gray-500">
                Notify me when a watched ticker gets a new signal.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={enableWatchedPoliticianAlerts}
              onChange={(event) =>
                setEnableWatchedPoliticianAlerts(event.target.checked)
              }
              disabled={isSaving}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">
                Watched politician alerts
              </div>
              <div className="text-sm text-gray-500">
                Notify me when a watched politician files a new signal.
              </div>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save preferences"}
            </button>

            {message && <span className="text-sm text-gray-500">{message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}