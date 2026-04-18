import type { AlertTier } from "@/lib/domain/alerts/should-generate-alert";
import type { SignalConfidenceTier } from "@/lib/domain/signals/get-signal-confidence-tier";

type GetSignalTakeawaysInput = {
  tradeType: string;
  score: string | number;
  alertTier: AlertTier | null;
  confidenceTier: SignalConfidenceTier;
  filingLagDays?: number | null;
  alpha7d?: string | number | null;
  alpha30d?: string | number | null;
  alpha90d?: string | number | null;
  historicalSampleSize?: number | null;
  amountRangeLabel?: string | null;
  tradeSizeScore?: string | number | null;
  historicalPoliticianScore?: string | number | null;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatSignedPoints(value: number): string {
  const rounded = value.toFixed(2);
  return `${value > 0 ? "+" : ""}${rounded}pp`;
}

export function getSignalTakeaways(input: GetSignalTakeawaysInput): string[] {
  const takeaways: string[] = [];

  const score = toNumber(input.score) ?? 0;
  const alpha30d = toNumber(input.alpha30d);
  const alpha7d = toNumber(input.alpha7d);
  const alpha90d = toNumber(input.alpha90d);
  const tradeSizeScore = toNumber(input.tradeSizeScore);
  const historicalPoliticianScore = toNumber(input.historicalPoliticianScore);
  const normalizedTradeType = input.tradeType.toLowerCase();

  if (normalizedTradeType === "purchase") {
    takeaways.push("Purchase disclosure, which carries a stronger base signal weight.");
  } else if (normalizedTradeType === "sale") {
    takeaways.push("Sale disclosure, which is treated more cautiously than purchases.");
  }

  if (alpha30d != null) {
    if (alpha30d >= 2) {
      takeaways.push(`Strong 30d outperformance vs SPY (${formatSignedPoints(alpha30d)}).`);
    } else if (alpha30d <= -2) {
      takeaways.push(`Weak 30d relative follow-through vs SPY (${formatSignedPoints(alpha30d)}).`);
    }
  } else if (alpha7d != null) {
    if (alpha7d >= 2) {
      takeaways.push(`Early 7d outperformance vs SPY (${formatSignedPoints(alpha7d)}).`);
    } else if (alpha7d <= -2) {
      takeaways.push(`Weak 7d relative follow-through vs SPY (${formatSignedPoints(alpha7d)}).`);
    }
  } else if (alpha90d != null && Math.abs(alpha90d) >= 2) {
    takeaways.push(`90d relative performance vs SPY is ${formatSignedPoints(alpha90d)}.`);
  }

  if (input.confidenceTier === "low") {
    takeaways.push("Low confidence due to limited support data for this setup.");
  } else if (input.confidenceTier === "medium") {
    if ((input.historicalSampleSize ?? 0) < 5) {
      takeaways.push(
        `Medium confidence due to a limited politician sample (${input.historicalSampleSize ?? 0} disclosures).`
      );
    } else {
      takeaways.push("Medium confidence while supporting history is still developing.");
    }
  }

  if (input.filingLagDays != null) {
    if (input.filingLagDays <= 45) {
      takeaways.push(`Filing arrived ${input.filingLagDays} days after trade, still reasonably timely.`);
    } else if (input.filingLagDays > 90) {
      takeaways.push(`Filed ${input.filingLagDays} days after trade, which reduces timeliness.`);
    }
  }

  if (
    tradeSizeScore != null
      ? tradeSizeScore >= 12
      : input.amountRangeLabel != null &&
        /\$1,000,001|\$5,000,001|\$15,000,001|\$50,000,001|\$100,000,001/.test(
          input.amountRangeLabel
        )
  ) {
    takeaways.push(
      input.amountRangeLabel
        ? `Large reported trade size (${input.amountRangeLabel}).`
        : "Large reported trade size compared with typical disclosures."
    );
  }

  if (historicalPoliticianScore != null) {
    if (historicalPoliticianScore >= 14) {
      takeaways.push("Politician has a strong historical score profile.");
    } else if (historicalPoliticianScore <= 6) {
      takeaways.push("Politician history is still limited or mixed.");
    }
  } else if ((input.historicalSampleSize ?? 0) <= 3) {
    takeaways.push("Politician history is still limited.");
  }

  if (takeaways.length < 2) {
    if (input.alertTier === "high_conviction") {
      takeaways.push("Meets high-conviction alert thresholds in the current model.");
    } else if (input.alertTier === "eligible") {
      takeaways.push("Meets alert-eligible thresholds in the current model.");
    }
  }

  if (takeaways.length < 2) {
    if (score >= 80) {
      takeaways.push("Signal score is in the top tier of current model outputs.");
    } else if (score >= 60) {
      takeaways.push("Signal score is above the model midpoint.");
    } else {
      takeaways.push("Signal score is modest versus other active signals.");
    }
  }

  if (takeaways.length < 2) {
    takeaways.push("Performance context is still limited for this disclosure.");
  }

  return takeaways.slice(0, 4);
}

export type { GetSignalTakeawaysInput };
