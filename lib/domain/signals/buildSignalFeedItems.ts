import {
  clusterSignals,
  type Signal,
  type SignalCluster,
} from "@/lib/domain/signals/clusterSignals";
import { formatTickerWithName } from "@/lib/domain/tickers/displayTicker";

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

function formatClusterDuration(cluster: SignalCluster): string {
  const durationDays = getDurationDays(cluster);

  if (durationDays === 0) return "Same day";
  if (durationDays === 1) return "Over 1 day";
  return `Over ${durationDays} days`;
}

function toRoundedScore(score: number): number {
  return Math.round(score);
}

function getClusterAssetLabel(cluster: SignalCluster): string {
  const latestSignal = cluster.signals[cluster.signals.length - 1];
  return formatTickerWithName({
    ticker: cluster.ticker,
    assetName: latestSignal.assetName,
  });
}

function buildHeadline(cluster: SignalCluster): string {
  const assetLabel = getClusterAssetLabel(cluster);

  if (cluster.dominantTradeType === "purchase") {
    return `${cluster.politician} made ${cluster.count} purchases in ${assetLabel}`;
  }

  if (cluster.dominantTradeType === "sale") {
    return `${cluster.politician} made ${cluster.count} sales in ${assetLabel}`;
  }

  return `${cluster.politician} made ${cluster.count} mixed trades in ${assetLabel}`;
}

function buildSubheadline(cluster: SignalCluster): string {
  const durationLabel = formatClusterDuration(cluster);

  if (cluster.count >= 3) {
    return `${durationLabel} • Avg score ${toRoundedScore(cluster.avgScore)} • Latest score ${toRoundedScore(cluster.latestScore)}`;
  }

  return `${durationLabel} • Max score ${toRoundedScore(cluster.maxScore)}`;
}

export function buildSignalFeedItems<TSignal extends Signal>(
  signals: TSignal[]
): SignalFeedItem<TSignal>[] {
  const normalizedSignals = signals.map(normalizeSignal);
  const signalOrder = new Map<TSignal, number>(
    normalizedSignals.map((signal, index) => [signal, index])
  );
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
    const leftIndex =
      left.type === "cluster"
        ? Math.min(...left.cluster.signals.map((signal) => signalOrder.get(signal) ?? Number.MAX_SAFE_INTEGER))
        : (signalOrder.get(left.signal) ?? Number.MAX_SAFE_INTEGER);
    const rightIndex =
      right.type === "cluster"
        ? Math.min(...right.cluster.signals.map((signal) => signalOrder.get(signal) ?? Number.MAX_SAFE_INTEGER))
        : (signalOrder.get(right.signal) ?? Number.MAX_SAFE_INTEGER);

    return leftIndex - rightIndex;
  });
}
