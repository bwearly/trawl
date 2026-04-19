const CLUSTER_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DominantTradeType = "purchase" | "sale" | "mixed";

export type Signal = {
  ticker: string;
  politician: string;
  tradeDate: Date;
  score: number;
  tradeType: string;
};

export type SignalCluster<TSignal extends Signal = Signal> = {
  ticker: string;
  politician: string;
  signals: TSignal[];
  count: number;
  firstTradeDate: Date;
  lastTradeDate: Date;
  avgScore: number;
  maxScore: number;
  latestScore: number;
  dominantTradeType: DominantTradeType;
};

type ClusterSeed<TSignal extends Signal> = {
  ticker: string;
  politician: string;
  signals: TSignal[];
};

function getDayDifference(from: Date, to: Date): number {
  return Math.abs(to.getTime() - from.getTime()) / MS_PER_DAY;
}

function toCluster<TSignal extends Signal>(seed: ClusterSeed<TSignal>): SignalCluster<TSignal> {
  const sortedSignals = [...seed.signals].sort(
    (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime()
  );

  const scores = sortedSignals.map((signal) => signal.score);
  const firstTradeDate = sortedSignals[0].tradeDate;
  const lastTradeDate = sortedSignals[sortedSignals.length - 1].tradeDate;
  const totalScore = scores.reduce((sum, score) => sum + score, 0);
  const avgScore = totalScore / scores.length;
  const maxScore = Math.max(...scores);
  const latestScore = sortedSignals[sortedSignals.length - 1].score;

  const allPurchases = sortedSignals.every((signal) => signal.tradeType === "purchase");
  const allSales = sortedSignals.every((signal) => signal.tradeType === "sale");

  const dominantTradeType: DominantTradeType = allPurchases
    ? "purchase"
    : allSales
      ? "sale"
      : "mixed";

  return {
    ticker: seed.ticker,
    politician: seed.politician,
    signals: sortedSignals,
    count: sortedSignals.length,
    firstTradeDate,
    lastTradeDate,
    avgScore,
    maxScore,
    latestScore,
    dominantTradeType,
  };
}

export function clusterSignals<TSignal extends Signal>(signals: TSignal[]): SignalCluster<TSignal>[] {
  const groupedByTickerAndPolitician = new Map<string, TSignal[]>();

  for (const signal of signals) {
    const key = `${signal.ticker}::${signal.politician}`;
    const groupedSignals = groupedByTickerAndPolitician.get(key);

    if (groupedSignals) {
      groupedSignals.push(signal);
    } else {
      groupedByTickerAndPolitician.set(key, [signal]);
    }
  }

  const clusters: SignalCluster<TSignal>[] = [];

  for (const groupedSignals of groupedByTickerAndPolitician.values()) {
    const sortedSignals = [...groupedSignals].sort(
      (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime()
    );

    let currentCluster: ClusterSeed<TSignal> | null = null;

    for (const signal of sortedSignals) {
      if (!currentCluster) {
        currentCluster = {
          ticker: signal.ticker,
          politician: signal.politician,
          signals: [signal],
        };
        continue;
      }

      const latestInCluster = currentCluster.signals[currentCluster.signals.length - 1];
      const dayDifference = getDayDifference(latestInCluster.tradeDate, signal.tradeDate);

      if (dayDifference <= CLUSTER_WINDOW_DAYS) {
        currentCluster.signals.push(signal);
      } else {
        clusters.push(toCluster(currentCluster));
        currentCluster = {
          ticker: signal.ticker,
          politician: signal.politician,
          signals: [signal],
        };
      }
    }

    if (currentCluster) {
      clusters.push(toCluster(currentCluster));
    }
  }

  const totalSignals = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  const averageClusterSize = clusters.length === 0 ? 0 : totalSignals / clusters.length;

  console.debug("[clusterSignals] signal clustering complete", {
    totalSignals: signals.length,
    totalClusters: clusters.length,
    averageClusterSize,
  });

  return clusters.sort((left, right) => {
    if (left.ticker !== right.ticker) {
      return left.ticker.localeCompare(right.ticker);
    }

    if (left.politician !== right.politician) {
      return left.politician.localeCompare(right.politician);
    }

    return left.firstTradeDate.getTime() - right.firstTradeDate.getTime();
  });
}
