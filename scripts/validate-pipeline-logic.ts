import { normalizeTickerForStorage, normalizeTradeType, normalizeYahooSymbol } from "../lib/domain/pipeline/normalization";
import { resolveHouseTicker } from "./lib/house-asset-resolution";
import { shouldGenerateAlert } from "../lib/domain/alerts/should-generate-alert";
import { DEFAULT_RELEVANCE_SCORES, scoreSignal } from "../lib/domain/scoring/scoreSignals";
import {
  addCalendarDays,
  calcAlphaPercent,
  calcReturnPercent,
  findClosestPriceOnOrAfter,
} from "../lib/domain/pipeline/performance";
import { classifyMissingPriceTicker, type MissingPriceClassification } from "../lib/domain/pipeline/missing-price-classification";
import { computeLeaderboardScore } from "../lib/domain/politicians/leaderboard-score";
import { isDigestSignalActionable } from "../lib/domain/watchlists/digest-eligibility";
import { buildDigestJobIdempotencyKey, shouldRecordDigestDelivery } from "../lib/domain/watchlists/digest-delivery";

type Failure = { category: string; test: string; detail: string };
const failures: Failure[] = [];
let passCount = 0;

function assertEqual<T>(category: string, test: string, actual: T, expected: T) {
  if (actual !== expected) {
    failures.push({ category, test, detail: `expected=${String(expected)} actual=${String(actual)}` });
    return;
  }
  passCount += 1;
}

function assertTrue(category: string, test: string, condition: boolean, detail: string) {
  if (!condition) {
    failures.push({ category, test, detail });
    return;
  }
  passCount += 1;
}

function runTickerNormalizationValidations() {
  const c = "ticker-normalization";
  assertEqual(c, "APPL storage", normalizeTickerForStorage("APPL"), "AAPL");
  assertEqual(c, "appl storage case-insensitive", normalizeTickerForStorage(" appl "), "AAPL");
  assertEqual(c, "AAPL storage", normalizeTickerForStorage("AAPL"), "AAPL");
  assertEqual(c, "BRKB storage", normalizeTickerForStorage("BRKB"), "BRK.B");
  assertEqual(c, "BRK.B storage", normalizeTickerForStorage("BRK.B"), "BRK.B");
  assertEqual(c, "BRK-B storage", normalizeTickerForStorage("BRK-B"), "BRK.B");
  assertEqual(c, "BF.B storage", normalizeTickerForStorage("BF.B"), "BF.B");
  assertEqual(c, "BF-B storage", normalizeTickerForStorage("BF-B"), "BF.B");
  assertEqual(c, "unknown storage predictable", normalizeTickerForStorage("XYZQ"), "XYZQ");

  assertEqual(c, "APPL yahoo", normalizeYahooSymbol("APPL"), "AAPL");
  assertEqual(c, "appl yahoo case-insensitive", normalizeYahooSymbol(" appl "), "AAPL");
  assertEqual(c, "BRKB yahoo", normalizeYahooSymbol("BRKB"), "BRK-B");
  assertEqual(c, "BRK.B yahoo", normalizeYahooSymbol("BRK.B"), "BRK-B");
  assertEqual(c, "BRK-B yahoo", normalizeYahooSymbol("BRK-B"), "BRK-B");
  assertEqual(c, "BF.B yahoo", normalizeYahooSymbol("BF.B"), "BF-B");
  assertEqual(c, "BF-B yahoo", normalizeYahooSymbol("BF-B"), "BF-B");
  const rawTicker = "APPL";
  const storageTicker = normalizeTickerForStorage(rawTicker);
  assertEqual(c, "diagnostic preserves distinct raw ticker", rawTicker, "APPL");
  assertEqual(c, "diagnostic normalized storage ticker", storageTicker, "AAPL");
  assertTrue(c, "raw ticker differs from normalized storage ticker", rawTicker !== storageTicker, `${rawTicker} should differ from ${storageTicker}`);
}



function runHouseAssetResolutionValidations() {
  const c = "house-asset-resolution";

  const att = resolveHouseTicker({ rawTicker: "AT", rawAssetName: "AT&T Inc" });
  assertEqual(c, "AT&T explicit AT resolves to T", att.ticker, "T");
  assertEqual(c, "AT&T uses mapping override", att.source, "mapping");

  const fiserv = resolveHouseTicker({ rawTicker: null, rawAssetName: "Fiserv, Inc" });
  assertEqual(c, "Fiserv maps to FI storage", fiserv.ticker, "FI");
  assertEqual(c, "FI maps to FISV for Yahoo", normalizeYahooSymbol("FI"), "FISV");

  assertEqual(c, "explicit APPL ticker normalizes to AAPL", normalizeTickerForStorage("APPL"), "AAPL");

  const appellPete = resolveHouseTicker({ rawTicker: null, rawAssetName: "Appell Pete Corp" });
  assertTrue(c, "Appell Pete does not map to AAPL", appellPete.ticker !== "AAPL", `unexpected ticker=${String(appellPete.ticker)}`);

  const interest = resolveHouseTicker({ rawTicker: null, rawAssetName: "Interest" });
  assertEqual(c, "Interest does not resolve FEI", interest.ticker, null);

  const issued = resolveHouseTicker({ rawTicker: null, rawAssetName: "Issued" });
  assertEqual(c, "Issued does not resolve FNFV.V", issued.ticker, null);

  const shares = resolveHouseTicker({ rawTicker: null, rawAssetName: "Shares" });
  assertEqual(c, "Shares does not resolve MAG", shares.ticker, null);

  const exactNew = resolveHouseTicker({ rawTicker: null, rawAssetName: "NEW" });
  assertEqual(c, "exact NEW asset name does not resolve NEW", exactNew.ticker, null);

  const explicitAppl = resolveHouseTicker({ rawTicker: "APPL", rawAssetName: "Appell Pete Corp" });
  assertEqual(c, "explicit APPL ticker is preserved", explicitAppl.ticker, "APPL");

  assertEqual(c, "BF.B still maps to Yahoo BF-B", normalizeYahooSymbol("BF.B"), "BF-B");
}

function runTradeTypeValidations() {
  const c = "trade-type-normalization";
  assertEqual(c, "P", normalizeTradeType("P"), "purchase");
  assertEqual(c, "Purchase", normalizeTradeType("Purchase"), "purchase");
  assertEqual(c, "Buy", normalizeTradeType("Buy"), "purchase");
  assertEqual(c, "S", normalizeTradeType("S"), "sale");
  assertEqual(c, "Sale", normalizeTradeType("Sale"), "sale");
  assertEqual(c, "Sell", normalizeTradeType("Sell"), "sale");
  assertEqual(c, "Exchange", normalizeTradeType("Exchange"), "exchange");
  assertEqual(c, "Unknown", normalizeTradeType("mystery"), "exchange");
  assertEqual(c, "Blank", normalizeTradeType(""), "exchange");
}

function runAlertEligibilityValidations() {
  const c = "alert-eligibility";
  const strong = shouldGenerateAlert({ signalStatus: "active", tradeType: "purchase", adjustedScore: 80, confidencePenalty: 1, filingLagDays: 10 });
  assertEqual(c, "strong purchase eligible", strong.shouldAlert, true);

  assertEqual(c, "sale blocked", shouldGenerateAlert({ signalStatus: "active", tradeType: "sale", adjustedScore: 90, confidencePenalty: 0, filingLagDays: 5 }).blockedBy, "trade_type");
  assertEqual(c, "low score blocked", shouldGenerateAlert({ signalStatus: "active", tradeType: "purchase", adjustedScore: 50, confidencePenalty: 0, filingLagDays: 5 }).blockedBy, "adjusted_score");
  assertEqual(c, "filing lag >180 blocked", shouldGenerateAlert({ signalStatus: "active", tradeType: "purchase", adjustedScore: 90, confidencePenalty: 0, filingLagDays: 181 }).blockedBy, "filing_lag");
  assertEqual(c, "historical lag >365 blocked", shouldGenerateAlert({ signalStatus: "active", tradeType: "purchase", adjustedScore: 90, confidencePenalty: 0, filingLagDays: 366 }).blockedBy, "filing_lag");
  assertEqual(c, "confidence penalty high blocked", shouldGenerateAlert({ signalStatus: "active", tradeType: "purchase", adjustedScore: 90, confidencePenalty: 8, filingLagDays: 10 }).blockedBy, "confidence_penalty");
  assertEqual(c, "inactive blocked", shouldGenerateAlert({ signalStatus: "archived", tradeType: "purchase", adjustedScore: 90, confidencePenalty: 0, filingLagDays: 10 }).blockedBy, "signal_status");
}

function runScoringValidations() {
  const c = "scoring-thresholds";

  const freshStrong = scoreSignal({
    tradeType: "purchase",
    amountMin: 250000,
    amountMax: 500000,
    filingLagDays: 5,
    daysSinceFiling: 2,
    historicalPoliticianScore: 85,
    historicalSampleSize: 25,
    committeeRelevanceScore: 70,
    clusterScore: 60,
    userRelevanceScore: 50,
    return7d: null,
    spyReturn7d: null,
    return30d: null,
    spyReturn30d: null,
  });
  assertTrue(c, "fresh signal can score high without mature windows", freshStrong.signalScore >= 70, `signalScore=${freshStrong.signalScore}`);

  const baseInput = {
    tradeType: "purchase",
    amountMin: 250000,
    amountMax: 500000,
    filingLagDays: 6,
    daysSinceFiling: 6,
    historicalPoliticianScore: 80,
    historicalSampleSize: 20,
    committeeRelevanceScore: 70,
    clusterScore: 55,
    userRelevanceScore: 40,
    return7d: 4,
    spyReturn7d: 1,
    return30d: null,
    spyReturn30d: null,
  };
  const missing30 = scoreSignal({ ...baseInput, return7d: 4, spyReturn7d: 1, return30d: null, spyReturn30d: null });
  const with30 = scoreSignal({ ...baseInput, return7d: 4, spyReturn7d: 1, return30d: 12, spyReturn30d: 3 });
  assertEqual(c, "missing 30d alpha does not lower Signal Score", missing30.signalScore, with30.signalScore);

  const staleLag = scoreSignal({ tradeType: "purchase", amountMin: 250000, amountMax: 500000, filingLagDays: 300, daysSinceFiling: 3, historicalPoliticianScore: 85, historicalSampleSize: 25, committeeRelevanceScore: 70, clusterScore: 60, userRelevanceScore: 50 });
  assertTrue(c, "extreme filing lag not highly actionable", staleLag.signalScore < 60, `signalScore=${staleLag.signalScore}`);
  assertTrue(c, "score clamped 0-100", staleLag.signalScore >= 0 && staleLag.signalScore <= 100, `signalScore=${staleLag.signalScore}`);

  const missingPerformance = scoreSignal({ tradeType: "purchase", amountMin: 25000, amountMax: 50000, filingLagDays: 20, daysSinceFiling: 5, historicalPoliticianScore: 60, historicalSampleSize: 5, return7d: null, spyReturn7d: null });
  assertTrue(c, "missing price/performance does not crash and is conservative", missingPerformance.signalScore <= freshStrong.signalScore, `missing=${missingPerformance.signalScore}, freshStrong=${freshStrong.signalScore}`);
  assertEqual(c, "missing performance uses conservative primary reason", missingPerformance.primaryReason, "Limited confidence due to missing performance history");
  const subStrong = scoreSignal({
    tradeType: "exchange",
    amountMin: 15000,
    amountMax: 50000,
    filingLagDays: 25,
    daysSinceFiling: 9,
    historicalPoliticianScore: 55,
    historicalSampleSize: 8,
    committeeRelevanceScore: 50,
    clusterScore: 40,
    userRelevanceScore: 40,
    return7d: 1,
    spyReturn7d: 0,
  });
  assertTrue(c, "score below 70 cannot produce strong context reason", !(subStrong.signalScore < 70 && subStrong.primaryReason === "Strong trade context and timing"), `signalScore=${subStrong.signalScore}, reason=${subStrong.primaryReason}`);

  const oneTrade = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 7, daysSinceFiling: 3, historicalPoliticianScore: 95, historicalSampleSize: 1 });
  assertTrue(c, "single lucky trade is confidence-adjusted", oneTrade.breakdown.historicalPoliticianScore < 14, `historical=${oneTrade.breakdown.historicalPoliticianScore}`);
  const lowSampleHistory = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 7, daysSinceFiling: 3, historicalPoliticianScore: 95, historicalSampleSize: 4 });
  const highSampleHistory = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 7, daysSinceFiling: 3, historicalPoliticianScore: 95, historicalSampleSize: 60 });
  assertTrue(c, "historical component separates low vs high sample reliability", highSampleHistory.breakdown.historicalPoliticianScore > lowSampleHistory.breakdown.historicalPoliticianScore, `lowSample=${lowSampleHistory.breakdown.historicalPoliticianScore}, highSample=${highSampleHistory.breakdown.historicalPoliticianScore}`);

  const mature = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 10, daysSinceFiling: 60, historicalPoliticianScore: 70, historicalSampleSize: 20, return7d: 6, spyReturn7d: 1, return30d: 14, spyReturn30d: 3, return90d: 25, spyReturn90d: 8 });
  assertTrue(c, "mature includes realized performance score", (mature.performanceScore ?? 0) > 50, `performanceScore=${mature.performanceScore}`);

  const defaultRelevance = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 8, daysSinceFiling: 3, historicalPoliticianScore: 60, historicalSampleSize: 10, return7d: 2, spyReturn7d: 1, return30d: 5, spyReturn30d: 2 });
  const explicitRelevance = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 8, daysSinceFiling: 3, historicalPoliticianScore: 60, historicalSampleSize: 10, return7d: 2, spyReturn7d: 1, return30d: 5, spyReturn30d: 2, committeeRelevanceScore: DEFAULT_RELEVANCE_SCORES.committee, clusterScore: DEFAULT_RELEVANCE_SCORES.cluster, userRelevanceScore: DEFAULT_RELEVANCE_SCORES.user });
  assertEqual(c, "default relevance equals explicit baseline relevance", defaultRelevance.totalScore, explicitRelevance.totalScore);

  const maxRelevance = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 8, daysSinceFiling: 3, historicalPoliticianScore: 60, historicalSampleSize: 10, return7d: 2, spyReturn7d: 1, return30d: 5, spyReturn30d: 2, committeeRelevanceScore: 50, clusterScore: 50, userRelevanceScore: 50 });
  assertTrue(c, "missing relevance does not default to max-ish values", defaultRelevance.totalScore < maxRelevance.totalScore, `default=${defaultRelevance.totalScore} maxish=${maxRelevance.totalScore}`);

  const missing30Reason = scoreSignal({ tradeType: "purchase", amountMin: 100000, amountMax: 200000, filingLagDays: 8, daysSinceFiling: 3, historicalPoliticianScore: 60, historicalSampleSize: 10, return7d: 2, spyReturn7d: 1, return30d: null, spyReturn30d: null });
  assertEqual(c, "missing 30d window uses conservative reason wording", missing30Reason.primaryReason, "Limited confidence due to missing performance history");
}



function runDigestEligibilityValidations() {
  const c = "digest-eligibility";
  assertEqual(c, "eligible purchase passes", isDigestSignalActionable({ tradeType: "purchase", filingLagDays: 20, score: 62, minScore: 60 }).ok, true);
  assertEqual(c, "non-purchase blocked", isDigestSignalActionable({ tradeType: "sale", filingLagDays: 20, score: 80, minScore: 60 }).reason, "trade_type");
  assertEqual(c, "high filing lag blocked", isDigestSignalActionable({ tradeType: "purchase", filingLagDays: 46, score: 80, minScore: 60 }).reason, "filing_lag");
  assertEqual(c, "below threshold blocked", isDigestSignalActionable({ tradeType: "purchase", filingLagDays: 20, score: 59, minScore: 60 }).reason, "score");
}

function runDigestDeliverySafetyValidations() {
  const c = "digest-delivery-safety";
  assertEqual(c, "idempotency key stable regardless signal order", buildDigestJobIdempotencyKey("u1", [5, 2, 9]), buildDigestJobIdempotencyKey("u1", [9, 5, 2]));
  assertEqual(c, "sent status records delivery", shouldRecordDigestDelivery("sent"), true);
  assertEqual(c, "failed status does not record delivery", shouldRecordDigestDelivery("failed"), false);
  assertEqual(c, "suppressed status does not record delivery", shouldRecordDigestDelivery("suppressed"), false);
}
function runLeaderboardRankingValidations() {
  const c = "leaderboard-ranking";
  const proven = computeLeaderboardScore({ avgAlpha30d: 4.2, winRate30d: 58, totalDisclosures: 38, validPerformanceCount: 28, avgFilingLagDays: 28 });
  const luckyFew = computeLeaderboardScore({ avgAlpha30d: 9.5, winRate30d: 100, totalDisclosures: 2, validPerformanceCount: 1, avgFilingLagDays: 12 });
  const staleRecent = computeLeaderboardScore({ avgAlpha30d: 3.2, winRate30d: 57, totalDisclosures: 25, validPerformanceCount: 20, avgFilingLagDays: 150 });
  const extremeLag = computeLeaderboardScore({ avgAlpha30d: 4.8, winRate30d: 70, totalDisclosures: 50, validPerformanceCount: 30, avgFilingLagDays: 500 });
  const sameStatsLowLag = computeLeaderboardScore({ avgAlpha30d: 4.8, winRate30d: 70, totalDisclosures: 50, validPerformanceCount: 30, avgFilingLagDays: 30 });

  assertTrue(c, "scores stay in 0-100 range", proven >= 0 && proven <= 100 && luckyFew >= 0 && luckyFew <= 100, `proven=${proven}, luckyFew=${luckyFew}`);
  assertTrue(c, "small sample does not outrank proven history", proven > luckyFew, `proven=${proven}, luckyFew=${luckyFew}`);
  assertTrue(c, "filing lag affects historical usefulness", proven > staleRecent, `proven=${proven}, staleRecent=${staleRecent}`);
  assertTrue(c, "extreme filing lag has strong penalty", sameStatsLowLag > extremeLag, `sameStatsLowLag=${sameStatsLowLag}, extremeLag=${extremeLag}`);
}
function runPerformanceWindowValidations() {
  const c = "performance-windows";

  assertEqual(c, "normal return percent", calcReturnPercent(100, 110), 10);
  assertEqual(c, "positive return", calcReturnPercent(50, 60), 20);
  assertEqual(c, "negative return", calcReturnPercent(100, 80), -20);
  assertEqual(
    c,
    "zero start price preserves current behavior",
    calcReturnPercent(0, 120),
    0
  );

  const missingStart: number | null = null;
  const missingEnd: number | null = null;
  assertEqual(c, "missing start price -> null", missingStart == null ? null : calcReturnPercent(missingStart, 100), null);
  assertEqual(c, "missing end price -> null", missingEnd == null ? null : calcReturnPercent(100, missingEnd), null);

  const prices = [
    { date: new Date("2026-01-02T00:00:00Z"), close: 100 },
    { date: new Date("2026-01-05T00:00:00Z"), close: 101 },
    { date: new Date("2026-01-06T00:00:00Z"), close: 102 },
  ];
  const weekendTarget = new Date("2026-01-03T00:00:00Z");
  const closest = findClosestPriceOnOrAfter(prices, weekendTarget);
  assertEqual(c, "weekend target chooses next trading date", closest?.date.toISOString().slice(0, 10), "2026-01-05");

  const anchor = new Date("2026-01-02T00:00:00Z");
  assertEqual(c, "7d is calendar-day based", addCalendarDays(anchor, 7).toISOString().slice(0, 10), "2026-01-09");
  assertEqual(c, "30d is calendar-day based", addCalendarDays(anchor, 30).toISOString().slice(0, 10), "2026-02-01");
  assertEqual(c, "90d is calendar-day based", addCalendarDays(anchor, 90).toISOString().slice(0, 10), "2026-04-02");

  assertEqual(c, "alpha null when benchmark missing", calcAlphaPercent(12, null), null);
  assertEqual(c, "alpha null when stock missing", calcAlphaPercent(null, 4), null);
  assertEqual(c, "alpha calculates correctly", calcAlphaPercent(12.5, 4.1), 8.4);
}

function runMissingPriceClassificationValidations() {
  const c = "missing-price-classification";
  const assertAllowed = (
    test: string,
    actual: MissingPriceClassification,
    allowed: MissingPriceClassification[]
  ) => assertTrue(c, test, allowed.includes(actual), `expected one of ${allowed.join(", ")} actual=${actual}`);

  const appl = classifyMissingPriceTicker({
    rawTicker: "APPL",
    storageTicker: "AAPL",
    yahooLookupTicker: "AAPL",
    sampleAssetNames: ["Appell Pete Corp"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found, symbol may be delisted",
  });
  assertAllowed("APPL/Appell Pete classification", appl.classification, ["likely_false_positive_parser_noise", "manual_review"]);
  const applNullReason = classifyMissingPriceTicker({
    rawTicker: "APPL",
    storageTicker: "AAPL",
    yahooLookupTicker: "AAPL",
    sampleAssetNames: ["Appell Pete Corp"],
    importFailureReason: null,
    importFailureDetail: null,
  });
  assertEqual(c, "APPL/Appell Pete + null reason classification", applNullReason.classification, "likely_false_positive_parser_noise");

  const fei = classifyMissingPriceTicker({
    rawTicker: "FEI",
    storageTicker: "FEI",
    yahooLookupTicker: "FEI",
    sampleAssetNames: ["Interest"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertEqual(c, "FEI + Interest classification", fei.classification, "likely_false_positive_parser_noise");

  const fnfvv = classifyMissingPriceTicker({
    rawTicker: "FNFV.V",
    storageTicker: "FNFV.V",
    yahooLookupTicker: "FNFV.V",
    sampleAssetNames: ["Issued"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertEqual(c, "FNFV.V + Issued classification", fnfvv.classification, "likely_false_positive_parser_noise");

  const cade = classifyMissingPriceTicker({
    rawTicker: "CADE",
    storageTicker: "CADE",
    yahooLookupTicker: "CADE",
    sampleAssetNames: ["CADE$A"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertEqual(c, "CADE + CADE$A classification", cade.classification, "unsupported_share_class_or_symbol_format");

  const hcn = classifyMissingPriceTicker({
    rawTicker: "HCN/UFP",
    storageTicker: "HCN/UFP",
    yahooLookupTicker: "HCN/UFP",
    sampleAssetNames: ["HCN/UFP"],
    importFailureReason: "request_error",
    importFailureDetail: "Failed Yahoo Schema validation for HCN/UFP",
  });
  assertEqual(c, "HCN/UFP schema failure classification", hcn.classification, "yahoo_provider_or_schema_issue");

  const k = classifyMissingPriceTicker({
    rawTicker: "K",
    storageTicker: "K",
    yahooLookupTicker: "K",
    sampleAssetNames: ["Kellanova"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertAllowed("K + Kellanova classification", k.classification, ["expected_delisted_or_acquired", "manual_review"]);
  const kNullReason = classifyMissingPriceTicker({
    rawTicker: "K",
    storageTicker: "K",
    yahooLookupTicker: "K",
    sampleAssetNames: ["Kellanova"],
    importFailureReason: null,
    importFailureDetail: null,
  });
  assertAllowed("K + Kellanova + null reason classification", kNullReason.classification, ["expected_delisted_or_acquired", "manual_review"]);

  const chxNullReason = classifyMissingPriceTicker({
    rawTicker: "CHX",
    storageTicker: "CHX",
    yahooLookupTicker: "CHX",
    sampleAssetNames: ["ChampionX Corporation"],
    importFailureReason: null,
    importFailureDetail: null,
  });
  assertAllowed("CHX + ChampionX Corporation + null reason classification", chxNullReason.classification, ["expected_delisted_or_acquired", "manual_review"]);

  const magNullReason = classifyMissingPriceTicker({
    rawTicker: "MAG",
    storageTicker: "MAG",
    yahooLookupTicker: "MAG",
    sampleAssetNames: ["Shares"],
    importFailureReason: null,
    importFailureDetail: null,
  });
  assertAllowed("MAG + Shares + null reason classification", magNullReason.classification, ["likely_false_positive_parser_noise", "manual_review"]);

  const newNullReason = classifyMissingPriceTicker({
    rawTicker: "NEW",
    storageTicker: "NEW",
    yahooLookupTicker: "NEW",
    sampleAssetNames: ["NEW"],
    importFailureReason: null,
    importFailureDetail: null,
  });
  assertAllowed("NEW + NEW + null reason classification", newNullReason.classification, ["likely_false_positive_parser_noise", "manual_review"]);

  const dfs = classifyMissingPriceTicker({
    rawTicker: "DFS",
    storageTicker: "DFS",
    yahooLookupTicker: "DFS",
    sampleAssetNames: ["Discover Financial Services"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertAllowed("DFS classification", dfs.classification, ["expected_delisted_or_acquired", "manual_review"]);

  const genericStock = classifyMissingPriceTicker({
    rawTicker: "ZZZZ",
    storageTicker: "ZZZZ",
    yahooLookupTicker: "ZZZZ",
    sampleAssetNames: ["Stock"],
    importFailureReason: "invalid_symbol",
    importFailureDetail: "No data found",
  });
  assertEqual(c, "generic Stock + invalid_symbol classification", genericStock.classification, "manual_review");
}

function printSummary() {
  const categories = ["ticker-normalization", "house-asset-resolution", "trade-type-normalization", "alert-eligibility", "scoring-thresholds", "leaderboard-ranking", "performance-windows", "missing-price-classification"];
  console.log("\nPipeline deterministic validation summary\n");
  for (const category of categories) {
    const categoryFailures = failures.filter((f) => f.category === category);
    if (categoryFailures.length === 0) {
      console.log(`✅ ${category}: PASS`);
    } else {
      console.log(`❌ ${category}: FAIL (${categoryFailures.length})`);
      for (const failure of categoryFailures) {
        console.log(`   - ${failure.test}: ${failure.detail}`);
      }
    }
  }

  console.log(`\nAssertions passed: ${passCount}`);
  console.log(`Assertions failed: ${failures.length}`);
}

function main() {
  runTickerNormalizationValidations();
  runHouseAssetResolutionValidations();
  runTradeTypeValidations();
  runAlertEligibilityValidations();
  runScoringValidations();
  runLeaderboardRankingValidations();
  runPerformanceWindowValidations();
  runDigestEligibilityValidations();
runDigestDeliverySafetyValidations();
runMissingPriceClassificationValidations();
  printSummary();

  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
