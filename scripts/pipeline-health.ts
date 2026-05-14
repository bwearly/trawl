import "dotenv/config";
import { count, desc, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  alertPreferences,
  alerts,
  disclosurePerformanceWindows,
  disclosures,
  priceHistory,
  researchSignals,
  watchlistItems,
  watchlists,
} from "../lib/db/schema";

type HealthSummary = {
  generatedAt: string;
  disclosure: Record<string, unknown>;
  priceHistory: Record<string, unknown>;
  performance: Record<string, unknown>;
  signals: Record<string, unknown>;
  alerts: Record<string, unknown>;
  watchlists: Record<string, unknown>;
  warnings: string[];
};

const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);
const SECTION_TIMEOUT_MS = 15_000;

async function withTimeout<T>(label: string, run: () => Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${SECTION_TIMEOUT_MS / 1000}s`)), SECTION_TIMEOUT_MS);
  });
  return Promise.race([run(), timeout]);
}

async function main() {
  console.log("Starting pipeline health check...");
  const warnings: string[] = [];

  console.log("[disclosure coverage] starting...");
  const { discTotals, disclosureBySource, disclosureByTradeType } = await withTimeout("disclosure coverage", async () => {
    const [discTotals] = await db.select({
      total: count(disclosures.id),
      withTicker: sql<number>`count(*) filter (where ${disclosures.ticker} is not null and btrim(${disclosures.ticker}) <> '')`,
      missingTicker: sql<number>`count(*) filter (where ${disclosures.ticker} is null or btrim(${disclosures.ticker}) = '')`,
      missingTradeDate: sql<number>`count(*) filter (where ${disclosures.tradeDate} is null)`,
      invalidDateOrder: sql<number>`count(*) filter (where ${disclosures.tradeDate} is not null and ${disclosures.filingDate} is not null and ${disclosures.filingDate} < ${disclosures.tradeDate})`,
      lagGt45: sql<number>`count(*) filter (where ${disclosures.filingLagDays} > 45)`,
      lagGt90: sql<number>`count(*) filter (where ${disclosures.filingLagDays} > 90)`,
      lagGt180: sql<number>`count(*) filter (where ${disclosures.filingLagDays} > 180)`,
      lagGt365: sql<number>`count(*) filter (where ${disclosures.filingLagDays} > 365)`,
    }).from(disclosures);
    const disclosureBySource = await db
      .select({ sourceLabel: disclosures.sourceLabel, count: count(disclosures.id) })
      .from(disclosures)
      .groupBy(disclosures.sourceLabel)
      .orderBy(desc(count(disclosures.id)));
    const disclosureByTradeType = await db
      .select({ tradeType: disclosures.tradeType, count: count(disclosures.id) })
      .from(disclosures)
      .groupBy(disclosures.tradeType)
      .orderBy(desc(count(disclosures.id)));
    return { discTotals, disclosureBySource, disclosureByTradeType };
  });
  console.log("[disclosure coverage] complete.");

  console.log("[price history coverage] starting...");
  const [priceTotals] = await withTimeout("price history coverage", async () => db.select({
    distinctPriceTickers: sql<number>`count(distinct upper(${priceHistory.ticker}))`,
    spyRows: sql<number>`count(*) filter (where upper(${priceHistory.ticker}) = 'SPY')`,
    earliestPriceDate: sql<Date | null>`min(${priceHistory.date})`,
    latestPriceDate: sql<Date | null>`max(${priceHistory.date})`,
  }).from(priceHistory));
  const [disclosureTickerTotals] = await withTimeout("disclosure ticker coverage", async () => db.select({
    distinctDisclosureTickers: sql<number>`count(distinct upper(${disclosures.ticker})) filter (where ${disclosures.ticker} is not null and btrim(${disclosures.ticker}) <> '')`,
  }).from(disclosures));
  const missingPriceTickers = await withTimeout("missing price ticker coverage", async () => db.execute(sql`
    select upper(d.ticker) as ticker, count(*)::int as count
    from ${disclosures} d
    left join ${priceHistory} p
      on upper(p.ticker) = upper(d.ticker)
    where d.ticker is not null and btrim(d.ticker) <> '' and p.id is null
    group by upper(d.ticker)
    order by count(*) desc, upper(d.ticker)
    limit 20
  `));
  console.log("[price history coverage] complete.");

  console.log("[performance window coverage] starting...");
  const [perfTotals] = await withTimeout("performance window coverage", async () => db.select({
    performanceRows: count(disclosurePerformanceWindows.id),
    with7d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return7d} is not null)`,
    with30d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return30d} is not null)`,
    with90d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return90d} is not null)`,
    withSpy7d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.spyReturn7d} is not null)`,
    withSpy30d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.spyReturn30d} is not null)`,
    withSpy90d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.spyReturn90d} is not null)`,
    withAlpha7d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return7d} is not null and ${disclosurePerformanceWindows.spyReturn7d} is not null)`,
    withAlpha30d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return30d} is not null and ${disclosurePerformanceWindows.spyReturn30d} is not null)`,
    withAlpha90d: sql<number>`count(*) filter (where ${disclosurePerformanceWindows.return90d} is not null and ${disclosurePerformanceWindows.spyReturn90d} is not null)`,
  }).from(disclosurePerformanceWindows));
  console.log("[performance window coverage] complete.");

  console.log("[signal coverage] starting...");
  const [signalTotals] = await withTimeout("signal totals", async () => db.select({
    totalSignals: count(researchSignals.id),
    missingTicker: sql<number>`count(*) filter (where ${researchSignals.ticker} is null or btrim(${researchSignals.ticker}) = '')`,
    missingPoliticianLink: sql<number>`count(*) filter (where ${researchSignals.politicianId} is null)`,
  }).from(researchSignals));

  const signalByStatus = await withTimeout("signal status coverage", async () => db
    .select({ signalStatus: researchSignals.signalStatus, count: count(researchSignals.id) })
    .from(researchSignals)
    .groupBy(researchSignals.signalStatus)
    .orderBy(desc(count(researchSignals.id))));

  const [signalBuckets] = await withTimeout("signal score buckets", async () => db.select({
    lt50: sql<number>`count(*) filter (where ${researchSignals.score}::numeric < 50)`,
    from50to64: sql<number>`count(*) filter (where ${researchSignals.score}::numeric >= 50 and ${researchSignals.score}::numeric < 65)`,
    from65to74: sql<number>`count(*) filter (where ${researchSignals.score}::numeric >= 65 and ${researchSignals.score}::numeric < 75)`,
    gte75: sql<number>`count(*) filter (where ${researchSignals.score}::numeric >= 75)`,
  }).from(researchSignals));

  const signalFilingLagBuckets = await withTimeout("signal filing lag buckets", async () => db.execute(sql`
    select
      case
        when d.filing_lag_days is null then 'unknown'
        when d.filing_lag_days <= 15 then 'fresh_0_15'
        when d.filing_lag_days <= 45 then 'normal_16_45'
        when d.filing_lag_days <= 90 then 'delayed_46_90'
        when d.filing_lag_days <= 180 then 'stale_91_180'
        when d.filing_lag_days <= 365 then 'very_stale_181_365'
        else 'historical_gt_365'
      end as bucket,
      count(*)::int as count
    from ${researchSignals} rs
    inner join ${disclosures} d on d.id = rs.disclosure_id
    group by 1
    order by 2 desc
  `));
  console.log("[signal coverage] complete.");

  console.log("[alert coverage] starting...");
  const [alertTotals] = await withTimeout("alert coverage", async () => db.select({
    totalAlerts: count(alerts.id),
    unreadAlerts: sql<number>`count(*) filter (where ${alerts.isRead} = false)`,
    linkedToSignal: sql<number>`count(*) filter (where ${alerts.researchSignalId} is not null)`,
    missingSignalLink: sql<number>`count(*) filter (where ${alerts.researchSignalId} is null)`,
    missingDisclosureLink: sql<number>`count(*) filter (where ${alerts.disclosureId} is null)`,
  }).from(alerts));

  const alertsByType = await withTimeout("alerts by type", async () => db
    .select({ type: alerts.type, count: count(alerts.id) })
    .from(alerts)
    .groupBy(alerts.type)
    .orderBy(desc(count(alerts.id))));
  console.log("[alert coverage] complete.");

  console.log("[watchlist/user coverage] starting...");
  const [watchlistTotals] = await withTimeout("watchlist/user coverage", async () => db.select({
    watchlists: count(watchlists.id),
    watchlistItems: sql<number>`(select count(*)::int from ${watchlistItems})`,
    watchlistUsers: sql<number>`count(distinct ${watchlists.userId})`,
    alertUsers: sql<number>`(select count(distinct ${alerts.userId})::int from ${alerts})`,
    prefUsers: sql<number>`(select count(distinct ${alertPreferences.userId})::int from ${alertPreferences})`,
    demoWatchlists: sql<number>`count(*) filter (where ${watchlists.userId} = 'demo-user')`,
    demoAlerts: sql<number>`(select count(*)::int from ${alerts} where ${alerts.userId} = 'demo-user')`,
    unionUsers: sql<number>`(
      select count(*)::int
      from (
        select distinct ${watchlists.userId} as user_id from ${watchlists}
        union
        select distinct ${alerts.userId} as user_id from ${alerts}
        union
        select distinct ${alertPreferences.userId} as user_id from ${alertPreferences}
      ) users
      where users.user_id is not null
    )`,
    nonDemoUsers: sql<number>`(
      select count(*)::int
      from (
        select distinct ${watchlists.userId} as user_id from ${watchlists}
        union
        select distinct ${alerts.userId} as user_id from ${alerts}
        union
        select distinct ${alertPreferences.userId} as user_id from ${alertPreferences}
      ) users
      where users.user_id is not null and users.user_id <> 'demo-user'
    )`,
  }).from(watchlists));
  console.log("[watchlist/user coverage] complete.");

  const disclosuresTotal = Number(discTotals?.total ?? 0);
  const disclosuresWithTicker = Number(discTotals?.withTicker ?? 0);
  const perfRows = Number(perfTotals?.performanceRows ?? 0);
  const totalSignals = Number(signalTotals?.totalSignals ?? 0);
  const pctTicker = pct(disclosuresWithTicker, disclosuresTotal);
  const pctPerfRows = pct(perfRows, disclosuresTotal);
  const pctSignalsPerDisclosure = pct(totalSignals, disclosuresTotal);
  const pctAlpha30 = pct(Number(perfTotals?.withAlpha30d ?? 0), perfRows);

  if (pctTicker < 80) warnings.push(`Heuristic warning: only ${pctTicker}% disclosures have tickers (<80%).`);
  if (Number(priceTotals?.spyRows ?? 0) === 0) warnings.push("Heuristic warning: SPY price history is missing (0 rows).");
  if (pctPerfRows < 70) warnings.push(`Heuristic warning: only ${pctPerfRows}% disclosures have performance windows (<70%).`);
  if (perfRows > 0 && pctAlpha30 < 50) warnings.push(`Heuristic warning: only ${pctAlpha30}% performance rows have 30d alpha (<50%).`);
  if (totalSignals === 0) warnings.push("Heuristic warning: no research signals exist.");
  const prefUsers = Number(watchlistTotals?.prefUsers ?? 0);
  if (prefUsers === 0) warnings.push("Heuristic warning: no alert preferences exist.");

  const unionUsers = Number(watchlistTotals?.unionUsers ?? 0);
  const nonDemoUsers = Number(watchlistTotals?.nonDemoUsers ?? 0);
  if (unionUsers > 0 && nonDemoUsers === 0) {
    warnings.push("Heuristic warning: all user-scoped data appears demo-user only.");
  }

  const summary: HealthSummary = {
    generatedAt: new Date().toISOString(),
    disclosure: {
      total: disclosuresTotal,
      withTicker: disclosuresWithTicker,
      missingTicker: Number(discTotals?.missingTicker ?? 0),
      percentWithTicker: pctTicker,
      bySourceLabel: disclosureBySource,
      byTradeType: disclosureByTradeType,
      missingTradeDate: Number(discTotals?.missingTradeDate ?? 0),
      filingDateBeforeTradeDate: Number(discTotals?.invalidDateOrder ?? 0),
      filingLag: {
        gt45: Number(discTotals?.lagGt45 ?? 0),
        gt90: Number(discTotals?.lagGt90 ?? 0),
        gt180: Number(discTotals?.lagGt180 ?? 0),
        gt365: Number(discTotals?.lagGt365 ?? 0),
      },
    },
    priceHistory: {
      distinctDisclosureTickers: Number(disclosureTickerTotals?.distinctDisclosureTickers ?? 0),
      distinctPriceTickers: Number(priceTotals?.distinctPriceTickers ?? 0),
      disclosureTickersMissingPriceHistory: missingPriceTickers.rows,
      spyPriceRowCount: Number(priceTotals?.spyRows ?? 0),
      earliestPriceDate: priceTotals?.earliestPriceDate ?? null,
      latestPriceDate: priceTotals?.latestPriceDate ?? null,
    },
    performance: {
      totalPerformanceRows: perfRows,
      percentDisclosuresWithPerformanceRows: pctPerfRows,
      percentWith7d: pct(Number(perfTotals?.with7d ?? 0), perfRows),
      percentWith30d: pct(Number(perfTotals?.with30d ?? 0), perfRows),
      percentWith90d: pct(Number(perfTotals?.with90d ?? 0), perfRows),
      percentWithSpy7d: pct(Number(perfTotals?.withSpy7d ?? 0), perfRows),
      percentWithSpy30d: pct(Number(perfTotals?.withSpy30d ?? 0), perfRows),
      percentWithSpy90d: pct(Number(perfTotals?.withSpy90d ?? 0), perfRows),
      percentWithAlpha7d: pct(Number(perfTotals?.withAlpha7d ?? 0), perfRows),
      percentWithAlpha30d: pctAlpha30,
      percentWithAlpha90d: pct(Number(perfTotals?.withAlpha90d ?? 0), perfRows),
    },
    signals: {
      totalSignals,
      percentDisclosuresWithSignals: pctSignalsPerDisclosure,
      byStatus: signalByStatus,
      scoreBuckets: {
        lt50: Number(signalBuckets?.lt50 ?? 0),
        from50to64: Number(signalBuckets?.from50to64 ?? 0),
        from65to74: Number(signalBuckets?.from65to74 ?? 0),
        gte75: Number(signalBuckets?.gte75 ?? 0),
      },
      filingLagBuckets: signalFilingLagBuckets.rows,
      missingTicker: Number(signalTotals?.missingTicker ?? 0),
      missingPoliticianLink: Number(signalTotals?.missingPoliticianLink ?? 0),
    },
    alerts: {
      totalAlerts: Number(alertTotals?.totalAlerts ?? 0),
      unreadAlerts: Number(alertTotals?.unreadAlerts ?? 0),
      byType: alertsByType,
      linkedToResearchSignal: Number(alertTotals?.linkedToSignal ?? 0),
      missingResearchSignalLink: Number(alertTotals?.missingSignalLink ?? 0),
      missingDisclosureLink: Number(alertTotals?.missingDisclosureLink ?? 0),
    },
    watchlists: {
      watchlists: Number(watchlistTotals?.watchlists ?? 0),
      watchlistItems: Number(watchlistTotals?.watchlistItems ?? 0),
      distinctUsers: {
        watchlists: Number(watchlistTotals?.watchlistUsers ?? 0),
        alerts: Number(watchlistTotals?.alertUsers ?? 0),
        alertPreferences: Number(watchlistTotals?.prefUsers ?? 0),
        unionUsers,
      },
      demoUserCounts: {
        watchlists: Number(watchlistTotals?.demoWatchlists ?? 0),
        alerts: Number(watchlistTotals?.demoAlerts ?? 0),
      },
    },
    warnings,
  };

  console.log("\n=== Pipeline Health Summary ===");
  console.log(`Generated at: ${summary.generatedAt}`);
  console.log("\n[Disclosure]");
  console.log(`- total: ${summary.disclosure.total}`);
  console.log(`- with ticker: ${summary.disclosure.withTicker} (${summary.disclosure.percentWithTicker}%)`);
  console.log(`- missing ticker: ${summary.disclosure.missingTicker}`);

  console.log("\n[Price History]");
  console.log(`- distinct disclosure tickers: ${summary.priceHistory.distinctDisclosureTickers}`);
  console.log(`- distinct price tickers: ${summary.priceHistory.distinctPriceTickers}`);
  console.log(`- SPY rows: ${summary.priceHistory.spyPriceRowCount}`);

  console.log("\n[Performance]");
  console.log(`- rows: ${summary.performance.totalPerformanceRows}`);
  console.log(`- coverage vs disclosures: ${summary.performance.percentDisclosuresWithPerformanceRows}%`);
  console.log(`- 30d alpha coverage: ${summary.performance.percentWithAlpha30d}%`);

  console.log("\n[Signals]");
  console.log(`- total: ${summary.signals.totalSignals}`);
  console.log(`- coverage vs disclosures: ${summary.signals.percentDisclosuresWithSignals}%`);

  console.log("\n[Alerts]");
  console.log(`- total: ${summary.alerts.totalAlerts}`);
  console.log(`- unread: ${summary.alerts.unreadAlerts}`);

  console.log("[warnings/output] starting...");
  console.log("\n[Warnings]");
  if (warnings.length === 0) {
    console.log("- none");
  } else {
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  console.log("\n=== Pipeline Health JSON ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("[warnings/output] complete.");
  process.exit(0);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("Pipeline health check failed:", error);
    process.exit(1);
  }
})();
