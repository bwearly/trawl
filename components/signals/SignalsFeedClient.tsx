"use client";

import { useState } from "react";
import SignalCard from "@/components/signals/SignalCard";
import SignalFilters from "@/components/signals/SignalFilters";
import type { SignalFilters as SignalFiltersType, SignalRow } from "@/lib/domain/signals/signals";

type SignalsFeedClientProps = {
  initialSignals: SignalRow[];
  initialFilters: SignalFiltersType;
};

function toDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export default function SignalsFeedClient({
  initialSignals,
  initialFilters,
}: SignalsFeedClientProps) {
  const [signals, setSignals] = useState<SignalRow[]>(initialSignals);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <>
      <div className="mb-4">
        <SignalFilters
          initialFilters={initialFilters}
          onResultsChange={setSignals}
          onLoadingChange={setIsLoading}
        />

        <div className="mt-2 min-h-5">
          {isLoading ? (
            <p className="text-sm font-medium text-gray-500">Updating results...</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {signals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            No results.
          </div>
        ) : (
          signals.map((signal) => (
            <SignalCard
              key={signal.signalId}
              signalId={signal.signalId}
              ticker={signal.ticker}
              score={signal.score}
              signalStatus={signal.signalStatus}
              politicianId={signal.politicianId}
              politicianName={signal.politicianName}
              tradeType={signal.tradeType}
              ownerType={signal.ownerType}
              amountRangeLabel={signal.amountRangeLabel}
              tradeDate={toDate(signal.tradeDate)}
              filingDate={toDate(signal.filingDate)}
              filingLagDays={signal.filingLagDays}
              sourceUrl={signal.sourceUrl}
              primaryReason={signal.primaryReason}
              reasonSummary={signal.reasonSummary}
            />
          ))
        )}
      </div>
    </>
  );
}
