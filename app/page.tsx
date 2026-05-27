import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import SignalCard from "@/components/signals/SignalCard";
import { getBiggestOutperformers } from "@/lib/domain/signals/get-biggest-outperformers";
import { getRecentlyFiled } from "@/lib/domain/signals/get-recently-filed";
import { getTopPicks } from "@/lib/domain/signals/get-top-picks";

export const metadata: Metadata = {
  title: "Trawl — Public Disclosure Research",
  description:
    "Track congressional trade disclosures, review ranked activity, validate performance, and stay on top of watchlists and research notifications.",
};

const marketRows = [
  ["NVDA", "+2.14%"],
  ["MSFT", "+0.82%"],
  ["AAPL", "-0.31%"],
  ["GOOGL", "+1.08%"],
  ["AMZN", "+0.47%"],
  ["META", "+1.72%"],
  ["JPM", "-0.18%"],
  ["PLTR", "+3.21%"],
];

function Sparkline({ variant = "up" }: { variant?: "up" | "down" | "steady" }) {
  const path =
    variant === "down"
      ? "M4 18 C18 8 28 10 40 14 C52 18 66 24 80 22 C94 20 106 26 120 30"
      : variant === "steady"
        ? "M4 24 C20 20 31 25 44 22 C58 18 70 20 84 18 C98 16 110 17 124 14"
        : "M4 30 C20 26 30 32 44 22 C58 12 70 18 82 10 C96 2 108 8 124 4";

  return (
    <svg
      viewBox="0 0 128 36"
      aria-hidden="true"
      className="h-10 w-32 text-gray-900/80"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d={`${path} L124 36 L4 36 Z`}
        fill="currentColor"
        opacity="0.06"
      />
    </svg>
  );
}

function MarketTickerTape() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 overflow-hidden opacity-90">
      <div className="animate-[market-tape_32s_linear_infinite] flex w-max gap-3 whitespace-nowrap px-6">
        {[...marketRows, ...marketRows].map(([ticker, move], index) => (
          <span
            key={`${ticker}-${index}`}
            className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur"
          >
            {ticker} <span className={move.startsWith("+") ? "text-emerald-600" : "text-rose-600"}>{move}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TradingHeroGraphic() {
  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-[2rem] border border-blue-100 bg-white p-5 shadow-2xl shadow-blue-100/70">
      <MarketTickerTape />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.16),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.14),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.9),transparent_48%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:36px_36px]" />

      <div className="relative z-10 mt-16 grid gap-4">
        <div className="animate-[float-panel_7s_ease-in-out_infinite] rounded-3xl border border-gray-200 bg-white/85 p-5 text-gray-950 shadow-xl shadow-blue-100/60 backdrop-blur-md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Live research board
              </p>
              <h3 className="mt-2 text-3xl font-bold tracking-tight">Signals moving today</h3>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Ranked
            </span>
          </div>

          <div className="mt-6 rounded-2xl bg-blue-50/80 p-4 ring-1 ring-blue-100">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-gray-600">Congressional disclosure momentum</p>
                <p className="mt-1 text-4xl font-bold tracking-tight">+18.7%</p>
              </div>
              <Sparkline />
            </div>
          </div>
        </div>

        <div className="ml-auto w-[88%] animate-[float-panel_8s_ease-in-out_infinite_1s] rounded-3xl border border-gray-200 bg-white/85 p-4 text-gray-950 shadow-xl shadow-blue-100/60 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-600">Recently filed</span>
            <span className="font-semibold text-amber-700">Fresh activity</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-gray-600">
            <div className="rounded-2xl bg-white/85 p-3">
              <p className="text-gray-950">Filings</p>
              <p className="mt-1 text-lg font-bold">3677</p>
            </div>
            <div className="rounded-2xl bg-white/85 p-3">
              <p className="text-gray-950">Signals</p>
              <p className="mt-1 text-lg font-bold">100%</p>
            </div>
            <div className="rounded-2xl bg-white/85 p-3">
              <p className="text-gray-950">Watch</p>
              <p className="mt-1 text-lg font-bold">Watchlist Notifications</p>
            </div>
          </div>
        </div>

        <div className="w-[82%] animate-[float-panel_9s_ease-in-out_infinite_0.5s] rounded-3xl border border-gray-200 bg-white/85 p-4 text-gray-950 shadow-xl shadow-blue-100/60 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
                Performance check
              </p>
              <p className="mt-1 text-sm text-gray-600">Compare moves against SPY.</p>
            </div>
            <Sparkline variant="steady" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionShell({
  eyebrow,
  title,
  description,
  href,
  linkLabel,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  accent: "blue" | "amber" | "emerald";
  children: ReactNode;
}) {
  const styles = {
    blue: "border-blue-200 bg-gradient-to-b from-blue-50 to-white text-blue-700",
    amber: "border-amber-200 bg-gradient-to-b from-amber-50 to-white text-amber-700",
    emerald: "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white text-emerald-700",
  }[accent];

  return (
    <section className={`rounded-3xl border p-6 shadow-sm ${styles}`}>
      <div className="flex min-h-[168px] flex-col justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em]">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">
            {title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-gray-600">{description}</p>
        </div>

        <Link
          href={href}
          className="inline-flex w-fit items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 transition soft-hover soft-focus hover:bg-gray-50"
        >
          {linkLabel} →
        </Link>
      </div>

      <div className="mt-5 space-y-4 text-gray-900">{children}</div>
    </section>
  );
}

function SignalEmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
      {label}
    </div>
  );
}

export default async function Home() {
  const [topPicks, recentlyFiled, biggestOutperformers] = await Promise.all([
    getTopPicks(4),
    getRecentlyFiled(4),
    getBiggestOutperformers(4),
  ]);

  return (
    <main className="min-h-screen overflow-hidden bg-gray-50">
      <style>{`
        @keyframes market-tape {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes float-panel {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
      `}</style>

      <section className="relative bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-6 py-16 text-gray-950 sm:py-20">
        <p className="mx-auto mb-6 max-w-6xl text-xs font-medium text-gray-600">Trawl surfaces disclosure activity for research. It does not recommend buying or selling securities.</p>
        <p className="mx-auto mb-6 max-w-6xl text-xs text-gray-500">Disclosure data may be delayed, incomplete, amended, or unavailable. Users should verify filings from the original source.</p>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(16,185,129,0.14),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.14),transparent_26%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700 shadow-sm backdrop-blur">
              Trawl market desk
            </p>

            <h1 className="mt-6 text-5xl font-bold tracking-tight text-gray-950 sm:text-6xl">
              A transparency dashboard for congressional disclosure activity.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600">
              Review public filings, compare historical context against SPY, and
              turn disclosure activity into a daily research workflow.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signals"
                className="rounded-xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-black"
              >
                Open research feed
              </Link>

              <Link
                href="/politicians"
                className="rounded-xl border border-gray-300 bg-white/70 px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-white"
              >
                View analytics
              </Link>

              <Link
                href="/watchlist"
                className="rounded-xl border border-gray-300 bg-white/70 px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-white"
              >
                Build watchlist
              </Link>
            </div>
          </div>

          <TradingHeroGraphic />
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          <Link
            href="/signals"
            className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Step 1
            </p>
            <h3 className="mt-2 text-lg font-bold text-gray-950">Scan disclosure activity</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Start with ranked research signals and sort by score, filing date,
              freshness, or ticker.
            </p>
          </Link>

          <Link
            href="/politicians"
            className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Step 2
            </p>
            <h3 className="mt-2 text-lg font-bold text-gray-950">Find repeat patterns</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Compare politicians by win rate, alpha vs SPY, sample size, and
              filing behavior.
            </p>
          </Link>

          <Link
            href="/alerts"
            className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Step 3
            </p>
            <h3 className="mt-2 text-lg font-bold text-gray-950">Track what matters</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Save tickers and politicians so new activity turns into research notifications.
            </p>
          </Link>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-gray-500">
                Research feed
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
                Three ways to review disclosure activity
              </h2>
            </div>
            <Link
              href="/signals"
              className="text-sm font-semibold text-gray-600 hover:text-gray-950"
            >
              View full signal feed →
            </Link>
          </div>

          <SectionShell
            eyebrow="Top signals"
            title="Current Research Signals"
            description="Recent disclosures are prioritized first, then score, so current research leads this view."
            href="/signals"
            linkLabel="Open desk"
            accent="blue"
          >
            {topPicks.length === 0 ? (
              <SignalEmptyState label="No research signals available yet." />
            ) : (
              topPicks.map((signal, index) => (
                <div key={signal.signalId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                      Current research
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      #{index + 1}
                    </span>
                  </div>
                  <SignalCard {...signal} />
                </div>
              ))
            )}
          </SectionShell>

          <SectionShell
            eyebrow="Fresh filings"
            title="Recently Filed"
            description="The newest congressional disclosures as they enter the research queue."
            href="/signals?sort=newest"
            linkLabel="Newest filings"
            accent="amber"
          >
            {recentlyFiled.length === 0 ? (
              <SignalEmptyState label="No recent filings available yet." />
            ) : (
              recentlyFiled.map((signal) => (
                <SignalCard key={signal.signalId} {...signal} />
              ))
            )}
          </SectionShell>

          <SectionShell
            eyebrow="Validation"
            title="Historical context vs SPY"
            description="Historical context showing how trade-linked moves compared with a market benchmark."
            href="/signals"
            linkLabel="Compare signals"
            accent="emerald"
          >
            {biggestOutperformers.length === 0 ? (
              <SignalEmptyState label="No historical SPY comparison data available yet." />
            ) : (
              biggestOutperformers.map((signal, index) => (
                <div key={signal.signalId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Historical context
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      #{index + 1} · {signal.chosenAlphaWindow} alpha{" "}
                      {signal.chosenAlpha >= 0 ? "+" : ""}
                      {signal.chosenAlpha.toFixed(2)}%
                    </span>
                  </div>
                  <SignalCard {...signal} />
                </div>
              ))
            )}
          </SectionShell>
        </div>
      </section>
    </main>
  );
}
