import {
  clusterSignals,
  type Signal,
  type SignalCluster,
} from "@/lib/domain/signals/clusterSignals";

export type SignalFeedItem<TSignal extends Signal = Signal> =
  | {
      type: "single";
      signal: TSignal;
    }
  | {
      type: "cluster";
      cluster: SignalCluster<TSignal>;
      summary: {
        headline: string;
        subheadline: string;
      };
    };

type SignalWithOptionalPoliticianName = Partial<Signal> & {
  politicianName?: string;
};

function normalizeSignal<TSignal extends Signal>(signal: TSignal): TSignal {
  const candidate = signal as TSignal & SignalWithOptionalPoliticianName;
  const politician = candidate.politician?.trim() || candidate.politicianName?.trim();

  if (!politician) {
    throw new Error(
      "buildSignalFeedItems expected each signal to include politician or politicianName"
    );
  }

  if (politician === signal.politician) {
    return signal;
  }

  return {
    ...signal,
    politician,
  };
}

function getDurationDays(cluster: SignalCluster): number {
  const ms = cluster.lastTradeDate.getTime() - cluster.firstTradeDate.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function toRoundedScore(score: number): number {
  return Math.round(score);
}

function buildHeadline(cluster: SignalCluster): string {
  if (cluster.dominantTradeType === "purchase") {
    return `${cluster.politician} made ${cluster.count} purchases in ${cluster.ticker}`;
  }

  if (cluster.dominantTradeType === "sale") {
    return `${cluster.politician} made ${cluster.count} sales in ${cluster.ticker}`;
  }

  return `${cluster.politician} made ${cluster.count} mixed trades in ${cluster.ticker}`;
}

function buildSubheadline(cluster: SignalCluster): string {
  const durationDays = getDurationDays(cluster);

  if (cluster.count >= 3) {
    return `Over ${durationDays} days • Avg score ${toRoundedScore(cluster.avgScore)} • Latest score ${toRoundedScore(cluster.latestScore)}`;
  }

  return `Over ${durationDays} days • Max score ${toRoundedScore(cluster.maxScore)}`;
}

export function buildSignalFeedItems<TSignal extends Signal>(
  signals: TSignal[]
): SignalFeedItem<TSignal>[] {
  const normalizedSignals = signals.map(normalizeSignal);
  const clusters = clusterSignals(normalizedSignals);

  const feedItems = clusters.map<SignalFeedItem<TSignal>>((cluster) => {
    if (cluster.count === 1) {
      return {
        type: "single",
        signal: cluster.signals[0],
      };
    }

    return {
      type: "cluster",
      cluster,
      summary: {
        headline: buildHeadline(cluster),
        subheadline: buildSubheadline(cluster),
      },
    };
  });

  return feedItems.sort((left, right) => {
    const leftDate = left.type === "cluster" ? left.cluster.lastTradeDate : left.signal.tradeDate;
    const rightDate = right.type === "cluster" ? right.cluster.lastTradeDate : right.signal.tradeDate;

    return rightDate.getTime() - leftDate.getTime();
  });
}
