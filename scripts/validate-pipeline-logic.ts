import { normalizeTickerForStorage, normalizeTradeType, normalizeYahooSymbol } from "../lib/domain/pipeline/normalization";
import { resolveHouseTicker } from "./lib/house-asset-resolution";
import { shouldGenerateAlert } from "../lib/domain/alerts/should-generate-alert";
import { scoreSignal } from "../lib/domain/scoring/scoreSignals";
import {
  addCalendarDays,
  calcAlphaPercent,
  calcReturnPercent,
  findClosestPriceOnOrAfter,
} from "../lib/domain/pipeline/performance";
import { classifyMissingPriceTicker, type MissingPriceClassification } from "../lib/domain/pipeline/missing-price-classification";

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
  const base = {
    amountMin: 100000,
    amountMax: 250000,
    filingLagDays: 10,
    return7d: 2,
    spyReturn7d: 1,
    return30d: 6,
    spyReturn30d: 2,
    historicalPoliticianScore: 12,
    committeeRelevanceScore: 5,
    clusterScore: 3,
    userRelevanceScore: 2,
  };

  const purchase = scoreSignal({ ...base, tradeType: "purchase" });
  const sale = scoreSignal({ ...base, tradeType: "sale" });
  const exchange = scoreSignal({ ...base, tradeType: "exchange" });
  assertTrue(c, "purchase > sale", purchase.totalScore > sale.totalScore, `${purchase.totalScore} <= ${sale.totalScore}`);
  assertTrue(c, "purchase > exchange", purchase.totalScore > exchange.totalScore, `${purchase.totalScore} <= ${exchange.totalScore}`);

  const fresh = scoreSignal({ ...base, tradeType: "purchase", filingLagDays: 10 });
  const stale = scoreSignal({ ...base, tradeType: "purchase", filingLagDays: 120 });
  assertTrue(c, "fresh > stale", fresh.totalScore > stale.totalScore, `${fresh.totalScore} <= ${stale.totalScore}`);

  const pos = scoreSignal({ ...base, tradeType: "purchase", return7d: 8, spyReturn7d: 1, return30d: 14, spyReturn30d: 3 });
  const neg = scoreSignal({ ...base, tradeType: "purchase", return7d: -3, spyReturn7d: 2, return30d: -7, spyReturn30d: 4 });
  assertTrue(c, "positive alpha raises score", pos.totalScore > neg.totalScore, `${pos.totalScore} <= ${neg.totalScore}`);

  const missingAlpha = scoreSignal({ ...base, tradeType: "purchase", return7d: null, spyReturn7d: null, return30d: null, spyReturn30d: null });
  assertEqual(c, "missing alpha baseline momentum=8", missingAlpha.breakdown.momentumScore, 8);

  assertTrue(c, "score bounds purchase", purchase.totalScore >= 0 && purchase.totalScore <= 100, `out of bounds ${purchase.totalScore}`);
  assertTrue(c, "score bounds negative", neg.totalScore >= 0 && neg.totalScore <= 100, `out of bounds ${neg.totalScore}`);
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
  const categories = ["ticker-normalization", "house-asset-resolution", "trade-type-normalization", "alert-eligibility", "scoring-thresholds", "performance-windows", "missing-price-classification"];
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
  runPerformanceWindowValidations();
  runMissingPriceClassificationValidations();
  printSummary();

  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
