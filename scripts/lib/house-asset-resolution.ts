export type TickerResolutionSource = "explicit" | "mapping" | "pattern" | "unresolved";

export type AssetNormalizationResult = {
  rawAssetName: string;
  cleanedAssetName: string;
  canonicalAssetName: string;
};

export type TickerResolutionResult = {
  ticker: string | null;
  source: TickerResolutionSource;
  normalization: AssetNormalizationResult;
};

const CANONICAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bINCORPORATED\b/g, "INC"],
  [/\bCORPORATION\b/g, "CORP"],
  [/\bCOMPANY\b/g, "CO"],
  [/\bLIMITED\b/g, "LTD"],
  [/\bCLASS\s+([A-Z])\b/g, "CL $1"],
];

// Keep this list small and high-confidence. Extend as recurring unresolved names are observed.
export const HOUSE_ASSET_NAME_TO_TICKER: Record<string, string> = {
  "ADVANCED MICRO DEVICES INC": "AMD",
  "ALPHABET INC": "GOOGL",
  "ALPHABET INC CL A": "GOOGL",
  "ALPHABET INC CL C": "GOOG",
  "AMAZON COM INC": "AMZN",
  "APPLE INC": "AAPL",
  "BERKSHIRE HATHAWAY INC CL B": "BRK.B",
  "COINBASE GLOBAL INC": "COIN",
  "MICROSOFT CORP": "MSFT",
  "NVIDIA CORP": "NVDA",
  "PALANTIR TECHNOLOGIES INC": "PLTR",
  "TESLA INC": "TSLA",
  "UNITED STATES OIL FUND LP": "USO",
  "VANGUARD TOTAL STOCK MARKET ETF": "VTI",
  "VANGUARD S AND P 500 ETF": "VOO",
  "SPDR S AND P 500 ETF TRUST": "SPY",
  "INVESCO QQQ TRUST": "QQQ",
  "ISHARES CORE S&P 500 ETF": "IVV",
};

function cleanSpacingAndPunctuation(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingNoise(value: string): string {
  return value
    .replace(/\s*\((?:NYSE|NASDAQ|AMEX)\s*:\s*[A-Z.\-]{1,10}\)\s*$/i, "")
    .replace(/\s*\(\s*[A-Z.\-]{1,10}\s*\)\s*$/i, "")
    .replace(/\s*[-,:;]\s*(?:COMMON STOCK|COM(?:MON)?(?:\s+STOCK)?|PFD|ADR)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toCanonicalAssetName(value: string): string {
  let canonical = value.toUpperCase().replace(/&/g, " AND ");

  for (const [pattern, replacement] of CANONICAL_REPLACEMENTS) {
    canonical = canonical.replace(pattern, replacement);
  }

  canonical = canonical
    .replace(/[^A-Z0-9. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return canonical;
}

export function normalizeAssetName(rawAssetName: string): AssetNormalizationResult {
  const cleanedAssetName = stripTrailingNoise(cleanSpacingAndPunctuation(rawAssetName));
  const canonicalAssetName = toCanonicalAssetName(cleanedAssetName);

  return {
    rawAssetName,
    cleanedAssetName,
    canonicalAssetName,
  };
}

function normalizeExplicitTicker(rawTicker: string | null): string | null {
  if (!rawTicker) return null;
  const candidate = rawTicker.trim().toUpperCase();
  if (!candidate) return null;

  if (/^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/.test(candidate)) {
    return candidate;
  }

  return null;
}

function resolveTickerFromPatterns(rawAssetName: string, canonicalAssetName: string): string | null {
  const inlineTickerMatch = rawAssetName.match(/\b(?:TICKER|SYMBOL)\s*[:\-]\s*([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\b/i);
  if (inlineTickerMatch?.[1]) {
    return inlineTickerMatch[1].toUpperCase();
  }

  const exchangeTickerMatch = rawAssetName.match(
    /\b(?:NYSE|NASDAQ|AMEX|NYSEARCA|OTC)\s*[:\-]\s*([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\b/i
  );
  if (exchangeTickerMatch?.[1]) {
    return exchangeTickerMatch[1].toUpperCase();
  }

  if (/^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/.test(canonicalAssetName)) {
    return canonicalAssetName;
  }

  return null;
}

export function resolveHouseTicker(params: {
  rawTicker: string | null;
  rawAssetName: string;
}): TickerResolutionResult {
  const normalization = normalizeAssetName(params.rawAssetName);

  const explicitTicker = normalizeExplicitTicker(params.rawTicker);
  if (explicitTicker) {
    return {
      ticker: explicitTicker,
      source: "explicit",
      normalization,
    };
  }

  const mappedTicker = HOUSE_ASSET_NAME_TO_TICKER[normalization.canonicalAssetName];
  if (mappedTicker) {
    return {
      ticker: mappedTicker,
      source: "mapping",
      normalization,
    };
  }

  const patternTicker = resolveTickerFromPatterns(
    normalization.cleanedAssetName,
    normalization.canonicalAssetName
  );
  if (patternTicker) {
    return {
      ticker: patternTicker,
      source: "pattern",
      normalization,
    };
  }

  return {
    ticker: null,
    source: "unresolved",
    normalization,
  };
}
