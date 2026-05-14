export type MissingPriceClassification =
  | "expected_delisted_or_acquired"
  | "unsupported_share_class_or_symbol_format"
  | "likely_false_positive_parser_noise"
  | "yahoo_provider_or_schema_issue"
  | "manual_review"
  | "unknown";

export type MissingPriceClassificationInput = {
  rawTicker: string;
  storageTicker: string;
  yahooLookupTicker: string;
  sampleAssetNames: string[];
  importFailureReason: string | null;
  importFailureDetail: string | null;
};

export function classifyMissingPriceTicker(input: MissingPriceClassificationInput): {
  classification: MissingPriceClassification;
  classificationReason: string;
} {
  const raw = input.rawTicker.trim().toUpperCase();
  const storage = input.storageTicker.trim().toUpperCase();
  const yahoo = input.yahooLookupTicker.trim().toUpperCase();
  const reason = (input.importFailureReason ?? "").trim().toLowerCase();
  const detail = (input.importFailureDetail ?? "").trim().toLowerCase();
  const assetNames = input.sampleAssetNames.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0);

  const hasAssetPattern = (...patterns: RegExp[]) => assetNames.some((name) => patterns.some((pattern) => pattern.test(name)));

  if (reason === "request_error" && detail.includes("failed yahoo schema validation")) {
    return {
      classification: "yahoo_provider_or_schema_issue",
      classificationReason: "Likely Yahoo provider/schema response issue based on request_error + schema validation detail.",
    };
  }

  if (raw.includes("/") || raw.includes("$") || raw.includes(" ") || hasAssetPattern(/\$/)) {
    return {
      classification: "unsupported_share_class_or_symbol_format",
      classificationReason: "Likely unsupported share-class or symbol format for the current price import pipeline.",
    };
  }

  if (
    hasAssetPattern(/\bappell pete corp\b/, /\binterest\b/, /\bissued\b/) ||
    hasAssetPattern(/\bshares\b/, /^new$/)
  ) {
    return {
      classification: "likely_false_positive_parser_noise",
      classificationReason: "Likely parser noise or extracted non-ticker token based on asset-name patterns.",
    };
  }

  if (reason === "invalid_symbol" && (raw !== storage || storage !== yahoo.replace(/-/g, "."))) {
    return {
      classification: "likely_false_positive_parser_noise",
      classificationReason: "Likely false-positive ticker extraction due to normalization mismatch and invalid symbol response.",
    };
  }

  if (hasAssetPattern(/\bkellanova\b/, /\bchampionx corporation\b/)) {
    return {
      classification: "expected_delisted_or_acquired",
      classificationReason: "Likely lifecycle transition (renamed/delisted/acquired) based on asset name pattern.",
    };
  }

  if (reason === "invalid_symbol") {
    if (hasAssetPattern(/\bchampionx\b/)) {
      return {
        classification: "expected_delisted_or_acquired",
        classificationReason: "Likely lifecycle transition (renamed/delisted/acquired) based on invalid symbol and asset name.",
      };
    }
    if (storage === "DFS") {
      return {
        classification: "expected_delisted_or_acquired",
        classificationReason: "Likely lifecycle transition (possibly delisted/acquired) based on invalid symbol response.",
      };
    }

    return {
      classification: "manual_review",
      classificationReason: "Likely unresolved lifecycle or mapping issue; manual review recommended for invalid symbol.",
    };
  }

  if (assetNames.some((name) => name === "stock")) {
    return {
      classification: "manual_review",
      classificationReason: "Likely ambiguous asset naming ('Stock'); manual review recommended.",
    };
  }

  if (reason === "request_error" || reason === "rate_limited" || reason === "no_data") {
    return {
      classification: "unknown",
      classificationReason: "Likely transient provider/data availability issue; needs re-check or manual review.",
    };
  }

  return {
    classification: "unknown",
    classificationReason: "Likely unclassified missing-price case; manual review recommended.",
  };
}
