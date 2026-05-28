const INVALID_TICKER_VALUES = new Set(["--", "—", "N/A", "NA", "NONE", "NULL"]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeDisplayTicker(rawTicker: string | null | undefined) {
  const normalized = collapseWhitespace(rawTicker ?? "");

  if (!normalized) return null;

  const upper = normalized.toUpperCase();
  return INVALID_TICKER_VALUES.has(upper) ? null : upper;
}

export function normalizeTickerAssetName(
  rawAssetName: string | null | undefined,
  ticker?: string | null
) {
  const assetName = collapseWhitespace(rawAssetName ?? "");

  if (!assetName) return null;

  const normalizedTicker = normalizeDisplayTicker(ticker);
  const upperAssetName = assetName.toUpperCase();

  if (INVALID_TICKER_VALUES.has(upperAssetName)) return null;
  if (!normalizedTicker) return assetName;
  if (upperAssetName === normalizedTicker) return null;

  const escapedTicker = escapeRegExp(normalizedTicker);
  const withoutTickerPrefix = collapseWhitespace(
    assetName.replace(new RegExp(`^${escapedTicker}(?:\\s*[-:•–—]\\s*|\\s+)`, "i"), "")
  );
  const withoutTickerSuffix = collapseWhitespace(
    withoutTickerPrefix
      .replace(new RegExp(`\\s*[([{]${escapedTicker}[)\\]}]$`, "i"), "")
      .replace(new RegExp(`\\s*[-:•–—]\\s*${escapedTicker}$`, "i"), "")
  );

  if (!withoutTickerSuffix) return null;
  if (withoutTickerSuffix.toUpperCase() === normalizedTicker) return null;

  return withoutTickerSuffix;
}

export function getTickerDisplayParts(input: {
  ticker?: string | null;
  assetName?: string | null;
}) {
  const ticker = normalizeDisplayTicker(input.ticker);
  const assetName = normalizeTickerAssetName(input.assetName, ticker);

  return {
    ticker,
    assetName,
    primary: ticker ?? assetName ?? null,
    secondary: ticker && assetName ? assetName : null,
  };
}

export function formatTickerWithName(input: {
  ticker?: string | null;
  assetName?: string | null;
}) {
  const display = getTickerDisplayParts(input);

  if (display.ticker && display.assetName) {
    return `${display.ticker} (${display.assetName})`;
  }

  return display.primary ?? "Unknown asset";
}
