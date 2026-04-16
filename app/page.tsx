import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
              Trawl
            </p>

            <h1 className="mt-4 text-5xl font-bold tracking-tight text-gray-950">
              Public-disclosure stock research signals
            </h1>

            <p className="mt-6 text-lg leading-8 text-gray-600">
              Monitor congressional trade disclosures, score them as research
              signals, and review the context before doing any deeper work.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signals"
                className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-black"
              >
                View signals
              </Link>

              <Link
                href="/signals?minScore=70&sort=score"
                className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                View high-score signals
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}