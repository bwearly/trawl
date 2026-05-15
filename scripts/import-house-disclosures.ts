import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveHouseTicker, type TickerResolutionSource } from "./lib/house-asset-resolution";
import { normalizeTradeType } from "../lib/domain/pipeline/normalization";
import { db } from "../lib/db";
import { alerts, disclosurePerformanceWindows, disclosures, politicians, researchSignals } from "../lib/db/schema";

const execFileAsync = promisify(execFile);

const HOUSE_SOURCE_LABEL = "House Clerk Financial Disclosure";

const AMOUNT_RANGE_MAP: Record<string, { min: number | null; max: number | null }> = {
  "$1,001 - $15,000": { min: 1001, max: 15000 },
  "$15,001 - $50,000": { min: 15001, max: 50000 },
  "$50,001 - $100,000": { min: 50001, max: 100000 },
  "$100,001 - $250,000": { min: 100001, max: 250000 },
  "$250,001 - $500,000": { min: 250001, max: 500000 },
  "$500,001 - $1,000,000": { min: 500001, max: 1000000 },
  "$1,000,001 - $5,000,000": { min: 1000001, max: 5000000 },
  "$5,000,001 - $25,000,000": { min: 5000001, max: 25000000 },
  "$25,000,001 - $50,000,000": { min: 25000001, max: 50000000 },
  "Over $50,000,000": { min: 50000001, max: null },
  "Over $1,000,000": { min: 1000001, max: null },
};

type HouseRow = Record<string, string>;
type NormalizationFailureReason =
  | "missing_trade_date"
  | "missing_filing_date"
  | "missing_trade_type"
  | "missing_asset_name"
  | "missing_politician_name"
  | "not_transaction_like_record";

type ParseDelimitedResult = {
  headers: string[];
  rows: HouseRow[];
};

type YearFetchResult = {
  rows: HouseRow[];
  zipEntries: string[];
  selectedFile: string | null;
  selectedHeaders: string[];
  xmlFile: string | null;
  xmlPreview: string | null;
};

type ImportMode = "manual" | "daily";

type NormalizedDisclosure = {
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house";
  ticker: string | null;
  assetName: string;
  assetType: string;
  assetCategory: "ST" | "OT" | "PS" | "GS" | "CS" | "unknown";
  tradeType: "purchase" | "sale" | "exchange";
  ownerType: "self" | "spouse" | "dependent" | "joint" | "unknown";
  amountRangeLabel: string | null;
  amountMin: number | null;
  amountMax: number | null;
  tradeDate: Date;
  filingDate: Date | null;
  filingLagDays: number | null;
  sourceUrl: string | null;
  sourceLabel: string;
  normalizedAssetName: string;
  tickerResolutionSource: TickerResolutionSource;
  debugRawLine?: string | null;
};

type ImportStats = {
  inserted: number;
  updated: number;
  skippedUnchanged: number;
  skippedInvalid: number;
  rejectionReasons: Map<ImportRejectedReason, number>;
  acceptedByAssetCategory: Map<NormalizedDisclosure["assetCategory"], number>;
  rejectedByAssetCategory: Map<NormalizedDisclosure["assetCategory"], number>;
};

type ImportRejectedReason =
  | "missing ticker"
  | "invalid trade date"
  | "trade date after filing date"
  | "future trade date"
  | "missing filing date"
  | "duplicate"
  | "non-stock/unsupported asset"
  | "parse failure";

type PtrRowSkipReason =
  | "missing_trade_date"
  | "missing_trade_type"
  | "missing_asset_name"
  | "ambiguous_line"
  | "non_stock_category";

type PtrAssetParseFailureReason =
  | "missing_asset_span"
  | "asset_name_amount_like"
  | "asset_name_too_short";

type PtrSuspiciousAssetSample = {
  reason: PtrAssetParseFailureReason;
  line: string;
  extractedAssetName: string;
  fallbackAssetName: string | null;
};

type PtrBeforeAfterSample = {
  line: string;
  before: string;
  after: string;
};

type PtrCandidateRecord = {
  assetText: string;
  tradeTypeRaw: string;
  dates: string[];
  amountText: string;
  rawText: string;
  assetCategory: NormalizedDisclosure["assetCategory"];
};

type ParsedStateDistrict = {
  raw: string;
  state: string | null;
};

const ALLOWED_SINGLE_LETTER_TICKERS = new Set(["F", "T", "U", "V", "C", "D", "K", "O", "S"]);
const DISALLOWED_STATE_TICKER_TOKENS = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "KY",
  "LA",
  "MA",
  "MD",
  "ME",
  "MI",
  "MN",
  "MO",
  "MS",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
  "DC",
]);
const DISALLOWED_ENTITY_TICKER_TOKENS = new Set([
  "LLC",
  "LLP",
  "LP",
  "INC",
  "CORP",
  "CO",
  "LTD",
  "PLC",
  "TPK",
  "AUTH",
  "MUNI",
  "BOND",
  "NOTE",
]);

const UNSUPPORTED_ASSET_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bmunicipal\b/i, reason: "municipal" },
  { pattern: /\bmuni\b/i, reason: "municipal" },
  { pattern: /\brevenue\b/i, reason: "municipal revenue" },
  { pattern: /\bturnpike\b/i, reason: "municipal/authority" },
  { pattern: /\bauthority\b/i, reason: "municipal/authority" },
  { pattern: /\bschool\s+district\b/i, reason: "municipal/school district" },
  { pattern: /\bcounty\b/i, reason: "municipal/county" },
  { pattern: /\bcity\s+of\b/i, reason: "municipal/city" },
  { pattern: /\bstate\s+of\b/i, reason: "municipal/state" },
  {
    pattern: /shares\s+jt\s+virginia\s+state\s+housing\s+development/i,
    reason: "housing development instrument",
  },
  { pattern: /\bhousing\s+development\b/i, reason: "housing development instrument" },
  { pattern: /\bbond\b/i, reason: "bond" },
  { pattern: /\bnote\b/i, reason: "note" },
  { pattern: /\bmaturity\b/i, reason: "maturity" },
  { pattern: /\bcoupon\b/i, reason: "coupon" },
  { pattern: /\btreasury\b/i, reason: "treasury" },
];

let rejectedFallbackTickerLogCount = 0;
const MAX_REJECTED_FALLBACK_TICKER_LOGS = 40;

const PTR_NON_TICKER_ASSET_NAME_DENYLIST = new Set(["INTEREST", "ISSUED", "SHARES", "NEW"]);

function isPtrNonTickerAssetNameNoise(assetName: string): boolean {
  return PTR_NON_TICKER_ASSET_NAME_DENYLIST.has(assetName.trim().toUpperCase());
}

function sanitizeParsedText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const withoutControlChars = raw.replace(/[\u0000-\u001f\u007f]/g, " ");
  const collapsedWhitespace = withoutControlChars.replace(/\s+/g, " ").trim();
  return collapsedWhitespace.length > 0 ? collapsedWhitespace : null;
}

function sanitizeParsedTextOrEmpty(raw: string | null | undefined): string {
  return sanitizeParsedText(raw) ?? "";
}

function extractAssetCategoryFromText(text: string): NormalizedDisclosure["assetCategory"] {
  if (/\[(ST|OT|PS|GS|CS)\]/i.test(text)) {
    const match = text.match(/\[(ST|OT|PS|GS|CS)\]/i)?.[1]?.toUpperCase();
    if (match === "ST" || match === "OT" || match === "PS" || match === "GS" || match === "CS") {
      return match;
    }
  }
  if (/\bcommon\s+stock\b/i.test(text)) return "ST";
  return "unknown";
}

function isLikelyPtrAssetStartLine(line: string): boolean {
  if (!line) return false;
  if (/shares?\s+sold\s*@/i.test(line)) return false;
  if (/\([A-Z][A-Z.\-]{0,7}\)\s*\[ST\]/.test(line)) return true;
  if (/\[ST\]/i.test(line)) return true;
  if (/\bcommon\s+stock\b/i.test(line)) return true;
  return false;
}

function getUnsupportedAssetReason(
  assetName: string,
  debugRawLine: string | null,
  assetCategory: NormalizedDisclosure["assetCategory"],
  assetType: string
): string | null {
  if (assetCategory !== "ST") return `asset category ${assetCategory}`;
  if (isAmountLikeAssetName(assetName)) return "amount-like asset name";
  if (assetType === "etf") return "etf/fund/index asset type";
  if (assetType === "option") return "option asset type";

  const combined = `${assetName} ${debugRawLine ?? ""}`;
  const matched = UNSUPPORTED_ASSET_PATTERNS.find(({ pattern }) => pattern.test(combined));
  return matched?.reason ?? null;
}

function hasUnsupportedAssetTerms(assetName: string, debugRawLine: string | null): boolean {
  const combined = `${assetName} ${debugRawLine ?? ""}`;
  return UNSUPPORTED_ASSET_PATTERNS.some(({ pattern }) => pattern.test(combined));
}

function isAllowedTickerToken(token: string): boolean {
  return token.length !== 1 || ALLOWED_SINGLE_LETTER_TICKERS.has(token);
}

function hasStockContext(text: string): boolean {
  return /\b(stock|common stock|shares?|class [a-z]|nyse|nasdaq|amex|ticker|symbol|etf|fund)\b/i.test(text);
}

function isDisallowedFallbackTickerToken(token: string): boolean {
  return DISALLOWED_STATE_TICKER_TOKENS.has(token) || DISALLOWED_ENTITY_TICKER_TOKENS.has(token);
}

function logRejectedFallbackTicker(
  candidateTicker: string,
  reasonRejected: string,
  rawLine: string,
  assetName: string
): void {
  if (rejectedFallbackTickerLogCount >= MAX_REJECTED_FALLBACK_TICKER_LOGS) return;
  console.log(
    `⚠️ Rejected fallback ticker[${rejectedFallbackTickerLogCount + 1}] candidate="${candidateTicker}" reason="${reasonRejected}" raw="${sanitizeParsedText(rawLine) ?? "(none)"}" asset="${sanitizeParsedText(assetName) ?? "(none)"}"`
  );
  rejectedFallbackTickerLogCount += 1;
}

function getArgValue(flag: string): string | undefined {
  const arg = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  if (!arg) return undefined;
  return arg.split("=")[1];
}

function parseYearsArg(): number[] {
  const yearsArg = getArgValue("--years");
  if (!yearsArg) {
    return [new Date().getUTCFullYear()];
  }

  return Array.from(
    new Set(
      yearsArg
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((year) => Number.isInteger(year) && year >= 2008)
    )
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDelimited(content: string): ParseDelimitedResult {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const delimiter = ["|", "\t", ","].reduce(
    (best, candidate) =>
      lines[0].split(candidate).length > lines[0].split(best).length ? candidate : best,
    "|"
  );

  const headers = lines[0].split(delimiter).map((h) => h.trim());

  const rows = lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((value) => value.trim());
    const row: HouseRow = {};

    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });

    return row;
  });

  return { headers, rows };
}

function getValue(row: HouseRow, aliases: string[]): string | null {
  const aliasSet = new Set(aliases.map((alias) => normalizeHeader(alias)));

  for (const [key, raw] of Object.entries(row)) {
    if (aliasSet.has(normalizeHeader(key))) {
      const value = sanitizeParsedText(raw);
      if (value) return value;
    }
  }

  return null;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value);
  if (!mdy) return null;

  const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
  const iso = `${year}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const normalized = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function normalizeParty(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value === "D" || value === "DEMOCRAT") return "Democrat";
  if (value === "R" || value === "REPUBLICAN") return "Republican";
  if (value === "I" || value === "INDEPENDENT") return "Independent";
  return raw.trim();
}

function normalizeOwnerType(raw: string | null): NormalizedDisclosure["ownerType"] {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "self";
  if (value.includes("spouse")) return "spouse";
  if (value.includes("child") || value.includes("dependent")) return "dependent";
  if (value.includes("joint")) return "joint";
  if (value === "jt") return "joint";
  if (value.includes("self")) return "self";
  return "self";
}

function inferAssetType(assetName: string): string {
  const value = assetName.toLowerCase();
  if (value.includes("etf") || value.includes("fund") || value.includes("index")) {
    return "etf";
  }
  if (value.includes("option") || value.includes("call") || value.includes("put")) {
    return "option";
  }
  if (value.includes("bond") || value.includes("note") || value.includes("treasury")) {
    return "other";
  }
  return "stock";
}

function normalizeAmountRange(raw: string | null): {
  label: string | null;
  min: number | null;
  max: number | null;
} {
  if (!raw) return { label: null, min: null, max: null };

  const label = raw.trim();
  if (!label) return { label: null, min: null, max: null };

  const mapped = AMOUNT_RANGE_MAP[label];
  if (mapped) return { label, min: mapped.min, max: mapped.max };

  const numbers = [...label.matchAll(/\$?([\d,]+)/g)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter((value) => Number.isFinite(value));

  if (label.toLowerCase().startsWith("over") && numbers[0]) {
    return { label, min: numbers[0], max: null };
  }

  if (numbers.length >= 2) {
    return { label, min: numbers[0], max: numbers[1] };
  }

  return { label, min: null, max: null };
}

function buildSourceUrl(year: number, row: HouseRow): string | null {
  const explicit = getValue(row, ["source url", "url", "document url", "pdf url"]);
  if (explicit) return explicit;

  const docId = getValue(row, ["document id", "docid", "filing id", "report id"]);
  if (!docId) return null;

  const numericDocId = docId.replace(/[^0-9]/g, "");
  if (!numericDocId) return null;

  return `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}/${numericDocId}.pdf`;
}

function getRowDocId(row: HouseRow): string | null {
  return getValue(row, ["document id", "docid", "filing id", "report id"]);
}

function getRowFilingType(row: HouseRow): string | null {
  return getValue(row, ["filing type", "filingtype", "type"]);
}

function buildDocumentUrlGuesses(year: number, docIdRaw: string): string[] {
  const docId = docIdRaw.replace(/[^0-9]/g, "");
  if (!docId) return [];

  const base = "https://disclosures-clerk.house.gov/public_disc";
  return [
    `${base}/financial-pdfs/${year}/${docId}.pdf`,
    `${base}/ptr-pdfs/${year}/${docId}.pdf`,
    `${base}/financial-xml/${year}/${docId}.xml`,
    `${base}/financial-pdfs/${docId}.pdf`,
    `${base}/ptr-pdfs/${docId}.pdf`,
  ];
}

async function extractPdfTextBuffer(buffer: Buffer): Promise<{
  text: string | null;
  pageCount: number;
  pageItemCounts: number[];
  error: string | null;
}> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false,
      verbosity: pdfjs.VerbosityLevel.WARNINGS,
    });
    loadingTask.onPassword = () => {
      throw new Error("Password-protected PDF is not supported.");
    };
    const pdfDocument = await loadingTask.promise;
    const pageTexts: string[] = [];
    const pageItemCounts: number[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pageItemCounts.push(textContent.items.length);
      const lines: string[] = [];
      let lineBuffer = "";

      for (const item of textContent.items as Array<{ str?: string; hasEOL?: boolean }>) {
        const value = (item.str ?? "").replace(/\u00a0/g, " ").trim();
        if (!value) {
          if (item.hasEOL && lineBuffer.trim().length > 0) {
            lines.push(lineBuffer.trim());
            lineBuffer = "";
          }
          continue;
        }

        lineBuffer = lineBuffer ? `${lineBuffer} ${value}` : value;

        if (item.hasEOL) {
          lines.push(lineBuffer.trim());
          lineBuffer = "";
        }
      }

      if (lineBuffer.trim().length > 0) {
        lines.push(lineBuffer.trim());
      }

      pageTexts.push(lines.join("\n"));
    }

    const text = pageTexts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    await loadingTask.destroy();
    return {
      text: text.length > 0 ? text : null,
      pageCount: pdfDocument.numPages,
      pageItemCounts,
      error: null,
    };
  } catch (error) {
    return {
      text: null,
      pageCount: 0,
      pageItemCounts: [],
      error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown PDF extraction error",
    };
  }
}

function parseOwnerTypeFromText(line: string): NormalizedDisclosure["ownerType"] {
  const upper = line.toUpperCase();
  if (/\bSP(OUSE)?\b/.test(upper)) return "spouse";
  if (/\bDC\b|\bDEPENDENT\b|\bCHILD\b/.test(upper)) return "dependent";
  if (/\bJT\b|\bJOINT\b/.test(upper)) return "joint";
  if (/\bSELF\b/.test(upper)) return "self";
  return "self";
}

function parseLeadingOwnerToken(line: string): { ownerType: NormalizedDisclosure["ownerType"]; ownerTokenLength: number } {
  const match = line.match(/^\s*(SP|SPOUSE|JT|JOINT|DC|DEPENDENT|CHILD|SELF)\b/i);
  if (!match) return { ownerType: "self", ownerTokenLength: 0 };
  return {
    ownerType: parseOwnerTypeFromText(match[1]),
    ownerTokenLength: match[0].length,
  };
}

function isValidTradingDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function normalizeDateFloor(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isFutureDate(date: Date, now: Date): boolean {
  return normalizeDateFloor(date).getTime() > normalizeDateFloor(now).getTime();
}

function isValidTickerToken(token: string): boolean {
  return /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(token);
}

function extractTickerFromPtrLine(
  line: string,
  assetName: string,
  assetCategory: NormalizedDisclosure["assetCategory"]
): string | null {
  if (isPtrNonTickerAssetNameNoise(assetName)) {
    return null;
  }

  const combinedContext = `${assetName} ${line}`;
  const unsupportedContext = hasUnsupportedAssetTerms(assetName, line);
  const parentheticalCandidates = [...`${assetName} ${line}`.matchAll(/\(([A-Z][A-Z.\-]{0,7})\)/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);

  for (const candidate of parentheticalCandidates) {
    const compact = candidate.replace(/-/g, "");
    if (!isValidTickerToken(compact)) continue;
    if (!isAllowedTickerToken(compact)) continue;
    if (isDisallowedFallbackTickerToken(compact)) {
      logRejectedFallbackTicker(compact, "disallowed parenthetical token", line, assetName);
      continue;
    }
    if (unsupportedContext && !hasStockContext(combinedContext)) {
      logRejectedFallbackTicker(compact, "parenthetical ticker in unsupported asset context", line, assetName);
      continue;
    }
    if (compact.length === 1 && !hasStockContext(combinedContext)) {
      logRejectedFallbackTicker(compact, "single-letter parenthetical ticker without stock context", line, assetName);
      continue;
    }
    if (isValidTickerToken(compact) && isAllowedTickerToken(compact)) {
      return compact;
    }
  }

  if (assetCategory !== "ST") {
    return null;
  }

  const fallbackText = `${assetName} ${line
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$[\d,\s.\-]+/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b(PURCHASE|SALE|EXCHANGE|BUY|SELL|PARTIAL|OVER|UNDER)\b/gi, " ")
    .replace(/\b(SP|SPOUSE|JT|JOINT|DC|DEPENDENT|CHILD|SELF)\b/gi, " ")}`;

  const tokens = [...fallbackText.matchAll(/\b[A-Z][A-Z0-9.\-]{0,4}\b/g)]
    .map((match) => match[0]?.trim().toUpperCase() ?? "")
    .filter(Boolean);
  const trailingTickerCandidate =
    assetName.match(/\b([A-Z]{1,5}(?:\.[A-Z])?)\s*$/)?.[1]?.trim().toUpperCase() ?? null;
  if (trailingTickerCandidate) {
    tokens.unshift(trailingTickerCandidate);
  }

  for (const token of tokens) {
    const compact = token.replace(/-/g, "");
    if (!isValidTickerToken(compact)) continue;
    if (!isAllowedTickerToken(compact)) {
      logRejectedFallbackTicker(compact, "ticker token not allowed", line, assetName);
      continue;
    }
    if (isDisallowedFallbackTickerToken(compact)) {
      logRejectedFallbackTicker(compact, "disallowed token (state/entity suffix)", line, assetName);
      continue;
    }
    if (/^\d/.test(compact)) continue;
    if (["OVER", "UNDER", "PRICE", "CASH", "SALE", "PURCH", "SP", "JT", "DC"].includes(compact)) continue;
    if (compact.length === 1 && !hasStockContext(combinedContext)) {
      logRejectedFallbackTicker(compact, "single-letter ticker without clear stock context", line, assetName);
      continue;
    }
    if (unsupportedContext && !hasStockContext(combinedContext)) {
      logRejectedFallbackTicker(compact, "unsupported asset context", line, assetName);
      continue;
    }
    return compact;
  }

  return null;
}

function extractLikelyAmountText(text: string): string | null {
  const match = text.match(
    /\b(PARTIAL\s+)?(OVER\s+\$?\s*[\d,\s]+|\$?\s*[\d,\s]+\s*-\s*\$?\s*[\d,\s]+)\b/i
  );
  return match?.[0]?.trim() ?? null;
}

function normalizeAmountInput(raw: string | null): string | null {
  if (!raw) return null;
  const compactedDigits = raw.replace(/(?<=\d)\s+(?=\d)/g, "");
  const normalizedWhitespace = compactedDigits.replace(/\s+/g, " ").trim();
  return normalizedWhitespace.length > 0 ? normalizedWhitespace : null;
}

function isAmountLikeAssetName(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  if (/^\$?[\d,\s]+(?:-\s*\$?[\d,\s]+)?$/i.test(normalized)) {
    return true;
  }
  if (/^[\d,\s]+\s*[A-Z]{1,2}$/i.test(normalized)) {
    return true;
  }

  const stripped = normalized
    .toUpperCase()
    .replace(/\b(PARTIAL|OVER|UNDER|LESS|THAN|MORE|FROM|TO|UP)\b/g, " ")
    .replace(/[$,\-.\s]/g, "");

  return stripped.length > 0 && /^\d+$/.test(stripped);
}

function buildLegacyPtrAssetCandidate(line: string): string {
  return line
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b(P|S|E|PURCHASE|SALE|EXCHANGE|BUY|SELL)\b/gi, " ")
    .replace(/\b(Over\s+\$[\d,]+|\$[\d,]+\s*-\s*\$[\d,]+)\b/gi, " ")
    .replace(/\b(SP|JT|DC|SELF|SPOUSE|DEPENDENT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\W+|\W+$/g, "")
    .trim();
}

function cleanAssetName(raw: string): string {
  return sanitizeParsedTextOrEmpty(raw)
    .replace(/^\s*(SP|SPOUSE|JT|JOINT|DC|DEPENDENT|CHILD|SELF)\b[:\-\s]*/i, "")
    .replace(/^\s*(Date|Amount|Cap\.?\s*Gains\s*>\s*\$200\?|Gains\s*>\s*\$200\?|\$200\?|SP|JT)\b[:\-\s]*/gi, "")
    .replace(/^\s*(?:Amount\s+Cap\.?\s*Gains\s*>\s*\$200\?\s*)/i, "")
    .replace(/^\s*(?:Cap\.?\s*)?Gains\s*>\s*\$200\?\s*/i, "")
    .replace(/^\s*\$200\?\s*/i, "")
    .replace(/^\s*Date\s+Amount\b[:\-\s]*/i, "")
    .replace(/\(partial\)/gi, " ")
    .replace(/\[ST\s*$/i, " ")
    .replace(/\s*\[(ST|OT|PS|GS|CS)\]\s*$/i, " ")
    .replace(/\s*\([A-Z][A-Z.\-]{0,7}\)\s*$/g, " ")
    .replace(/\bCommon\s+Stock\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\W+|\W+$/g, "")
    .trim();
}

function hasDiscardableAssetPrefix(value: string): boolean {
  return /^(Amount|Gains|\$200\?|Date\s+Amount|Stock\s*\()/i.test(value.trim());
}

function scoreAssetNameQuality(value: string): number {
  const normalized = sanitizeParsedTextOrEmpty(value);
  if (!normalized) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (hasDiscardableAssetPrefix(normalized)) score -= 120;
  if (/\b[A-Za-z][A-Za-z&.,'\- ]+\s+\([A-Z]{1,5}(?:\.[A-Z]{1,2})?\)/.test(normalized)) score += 50;
  if (/\b[A-Za-z]{3,}/.test(normalized)) score += 20;
  score += Math.min(normalized.length, 80);

  return score;
}

function buildPoliticianNameFromHouseRow(row: HouseRow): string | null {
  const explicit = getValue(row, ["filer", "name", "member", "full name"]);
  if (explicit) return explicit;

  const prefix = (getValue(row, ["prefix"]) ?? "").trim();
  const first = (getValue(row, ["first", "firstname"]) ?? "").trim();
  const last = (getValue(row, ["last", "lastname"]) ?? "").trim();
  const combined = [prefix, first, last].filter(Boolean).join(" ").trim();
  return combined.length > 0 ? combined : null;
}

function normalizePtrLine(line: string): string {
  return sanitizeParsedTextOrEmpty(line.replace(/\u00a0/g, " "));
}

function parseStateFromDistrictValue(rawValue: string | null | undefined): ParsedStateDistrict | null {
  const raw = sanitizeParsedText(rawValue);
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]{2})\D*\d{0,3}$/);
  if (!match) {
    return { raw, state: null };
  }
  return { raw, state: match[1] ?? null };
}

function parseStateDistrictFromPdfText(text: string): ParsedStateDistrict | null {
  const match = text.match(/State\s*\/\s*District\s*:\s*([A-Za-z0-9\-\s]+)/i);
  if (!match) return null;
  return parseStateFromDistrictValue(match[1] ?? null);
}

function splitPtrLineOnTypeTokens(line: string): string[] {
  const out: string[] = [];
  const compact = normalizePtrLine(line);
  if (!compact) return out;
  out.push(compact);

  const splitWithDelimitedSingleLetter = compact.replace(/\b([PSE])\b(?=\S)/g, "$1 ");
  if (splitWithDelimitedSingleLetter !== compact) {
    out.push(normalizePtrLine(splitWithDelimitedSingleLetter));
  }

  const splitDateTypeDate = compact.replace(
    /(\d{1,2}\/\d{1,2}\/\d{2,4})([PSE])(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
    "$1 $2 $3"
  );
  if (splitDateTypeDate !== compact) {
    out.push(normalizePtrLine(splitDateTypeDate));
  }

  return [...new Set(out)].filter(Boolean);
}

function buildPtrCandidates(lines: string[]): PtrCandidateRecord[] {
  const candidates: PtrCandidateRecord[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const startLine = lines[i];
    if (!isLikelyPtrAssetStartLine(startLine)) continue;

    const assetCategory = extractAssetCategoryFromText(startLine);
    const windowEnd = Math.min(lines.length - 1, i + 3);
    const segments: string[] = [];
    let matched = false;
    for (let j = i; j <= windowEnd && !matched; j += 1) {
      const nextLine = lines[j];
      if (j > i && isLikelyPtrAssetStartLine(nextLine)) break;
      if (/shares?\s+sold\s*@/i.test(nextLine)) break;
      segments.push(nextLine);
      const mergedVariants = splitPtrLineOnTypeTokens(segments.join(" "));
      for (const merged of mergedVariants) {
        const amountText = normalizeAmountInput(extractLikelyAmountText(merged));
        if (!amountText) continue;
        const txMatch = merged.match(/\b(Purchase|Sale|Exchange|P|S|E)\b/i);
        if (!txMatch) continue;
        const dates = [...merged.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)].map((match) => match[0]);
        if (dates.length === 0) continue;
        const amountIndex = merged.indexOf(amountText);
        const txIndex = txMatch.index ?? -1;
        if (txIndex < 0 || amountIndex < 0) continue;
        const cutoff = Math.min(txIndex, amountIndex);
        const assetText = cleanAssetName(merged.slice(0, cutoff));
        if (!assetText) continue;
        candidates.push({
          assetText,
          tradeTypeRaw: txMatch[1],
          dates: dates.slice(0, 2),
          amountText,
          rawText: merged,
          assetCategory,
        });
        matched = true;
        break;
      }
    }
  }

  return candidates;
}

function parsePtrTransactionsFromPdfText(params: {
  text: string;
  sourceRow: HouseRow;
  sourceUrl: string;
}): {
  normalized: NormalizedDisclosure[];
  transactionLikeLineCount: number;
  candidateCountAfterDedupe: number;
  duplicateCandidatesRemoved: number;
  skipReasons: Map<PtrRowSkipReason, number>;
  assetFailureReasons: Map<PtrAssetParseFailureReason, number>;
  suspiciousAssetSamples: PtrSuspiciousAssetSample[];
  beforeAfterSamples: PtrBeforeAfterSample[];
} {
  const { text, sourceRow, sourceUrl } = params;
  const lines = text
    .split(/\r?\n/)
    .map(normalizePtrLine)
    .filter((line) => line.length > 0);

  const skipReasons = new Map<PtrRowSkipReason, number>();
  const assetFailureReasons = new Map<PtrAssetParseFailureReason, number>();
  const normalized: NormalizedDisclosure[] = [];
  const suspiciousAssetSamples: PtrSuspiciousAssetSample[] = [];
  const beforeAfterSamples: PtrBeforeAfterSample[] = [];
  const politicianName = sanitizeParsedTextOrEmpty(
    buildPoliticianNameFromHouseRow(sourceRow) ?? "Unknown House Member"
  );
  const filingDate = parseDate(getValue(sourceRow, ["filing date", "filingdate", "filed"]));
  const party = normalizeParty(getValue(sourceRow, ["party"]));
  const stateFromRow = parseStateFromDistrictValue(
    getValue(sourceRow, ["state", "district state", "st", "state/district"])
  );
  const stateFromPdf = parseStateDistrictFromPdfText(text);
  const state = stateFromRow?.state ?? stateFromPdf?.state ?? null;
  if (stateFromPdf) {
    if (stateFromPdf.state) {
      console.log(
        `🧪 PTR parsed State/District="${stateFromPdf.raw}" -> state="${stateFromPdf.state}"`
      );
    } else {
      console.log(`⚠️ PTR malformed State/District value: "${stateFromPdf.raw}"`);
    }
  } else {
    console.log("⚠️ PTR missing State/District field in extracted PDF text.");
  }
  if (stateFromRow && !stateFromRow.state) {
    console.log(`⚠️ PTR malformed row state value: "${stateFromRow.raw}"`);
  }
  const now = new Date();
  let debugRowsLogged = 0;

  const candidates = buildPtrCandidates(lines);
  const transactionLikeLineCount = candidates.length;
  const candidateRows: NormalizedDisclosure[] = [];

  for (const candidate of candidates) {
    const parsedTradeDate = parseDate(candidate.dates[0] ?? null);
    if (!parsedTradeDate) {
      skipReasons.set("missing_trade_date", (skipReasons.get("missing_trade_date") ?? 0) + 1);
      continue;
    }

    const tradeTypeMatch = candidate.tradeTypeRaw.match(/(Purchase|Sale|Exchange|P|S|E)/i);
    if (!tradeTypeMatch || !tradeTypeMatch[1]) {
      skipReasons.set("missing_trade_type", (skipReasons.get("missing_trade_type") ?? 0) + 1);
      continue;
    }

    const amountText = normalizeAmountInput(candidate.amountText);
    const amount = normalizeAmountRange(amountText);

    const line = candidate.rawText;
    const legacyAssetName = buildLegacyPtrAssetCandidate(line);
    const assetName = cleanAssetName(candidate.assetText);
    if (!assetName) {
      assetFailureReasons.set(
        "missing_asset_span",
        (assetFailureReasons.get("missing_asset_span") ?? 0) + 1
      );
      skipReasons.set("missing_asset_name", (skipReasons.get("missing_asset_name") ?? 0) + 1);
      continue;
    }

    if (isAmountLikeAssetName(assetName)) {
      assetFailureReasons.set(
        "asset_name_amount_like",
        (assetFailureReasons.get("asset_name_amount_like") ?? 0) + 1
      );
      if (suspiciousAssetSamples.length < 10) {
        suspiciousAssetSamples.push({
          reason: "asset_name_amount_like",
          line,
          extractedAssetName: assetName,
          fallbackAssetName: legacyAssetName.length > 0 ? legacyAssetName : null,
        });
      }
      skipReasons.set("missing_asset_name", (skipReasons.get("missing_asset_name") ?? 0) + 1);
      continue;
    }

    if (assetName.length < 3) {
      assetFailureReasons.set(
        "asset_name_too_short",
        (assetFailureReasons.get("asset_name_too_short") ?? 0) + 1
      );
      if (suspiciousAssetSamples.length < 10) {
        suspiciousAssetSamples.push({
          reason: "asset_name_too_short",
          line,
          extractedAssetName: assetName,
          fallbackAssetName: legacyAssetName.length > 0 ? legacyAssetName : null,
        });
      }
      skipReasons.set("missing_asset_name", (skipReasons.get("missing_asset_name") ?? 0) + 1);
      continue;
    }

    if (beforeAfterSamples.length < 8 && legacyAssetName !== assetName) {
      beforeAfterSamples.push({ line, before: legacyAssetName, after: assetName });
    }

    if (assetName.split(" ").length > 40) {
      skipReasons.set("ambiguous_line", (skipReasons.get("ambiguous_line") ?? 0) + 1);
      continue;
    }

    let tradeDate = parsedTradeDate;
    if (
      filingDate &&
      isValidTradingDate(filingDate) &&
      !isFutureDate(filingDate, now) &&
      (!isValidTradingDate(tradeDate) || isFutureDate(tradeDate, now) || tradeDate.getTime() > filingDate.getTime())
    ) {
      tradeDate = filingDate;
    }

    const filingLagDays = filingDate
      ? Math.floor((filingDate.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    if (filingLagDays != null && filingLagDays < 0) {
      skipReasons.set("missing_trade_date", (skipReasons.get("missing_trade_date") ?? 0) + 1);
      continue;
    }

    if (candidate.assetCategory !== "ST") {
      skipReasons.set("non_stock_category", (skipReasons.get("non_stock_category") ?? 0) + 1);
      continue;
    }

    const rawTicker = extractTickerFromPtrLine(line, assetName, candidate.assetCategory);

    const resolvedTicker = resolveHouseTicker({
      rawTicker,
      rawAssetName: assetName,
    });

    const ownerType = parseLeadingOwnerToken(line).ownerType;
    const tradeType = normalizeTradeType(tradeTypeMatch[1] ?? null);
    const sanitizedTicker = sanitizeParsedText(resolvedTicker.ticker)?.toUpperCase() ?? null;
    const finalTicker = sanitizedTicker && isAllowedTickerToken(sanitizedTicker) ? sanitizedTicker : null;
    const sanitizedAssetName = sanitizeParsedTextOrEmpty(assetName);
    const sanitizedLine = sanitizeParsedText(line);

    if (debugRowsLogged < 20) {
      console.log(
        `🧪 PTR debug row[${debugRowsLogged + 1}] raw="${sanitizedLine ?? "(none)"}" ticker="${finalTicker ?? "null"}" tradeDate="${tradeDate.toISOString().slice(0, 10)}" filingDate="${filingDate ? filingDate.toISOString().slice(0, 10) : "null"}" owner="${ownerType}" tradeType="${tradeType}"`
      );
      debugRowsLogged += 1;
    }

    candidateRows.push({
      politicianName,
      party,
      state,
      chamber: "house",
      ticker: finalTicker,
      assetName: sanitizedAssetName,
      assetType: inferAssetType(sanitizedAssetName),
      assetCategory: candidate.assetCategory,
      tradeType,
      ownerType,
      amountRangeLabel: sanitizeParsedText(amount.label),
      amountMin: amount.min,
      amountMax: amount.max,
      tradeDate,
      filingDate,
      filingLagDays,
      sourceUrl: sanitizeParsedText(sourceUrl),
      sourceLabel: sanitizeParsedTextOrEmpty(HOUSE_SOURCE_LABEL),
      normalizedAssetName: sanitizeParsedTextOrEmpty(resolvedTicker.normalization.canonicalAssetName),
      tickerResolutionSource: resolvedTicker.source,
      debugRawLine: sanitizedLine,
    });
  }

  const dedupedCandidates = new Map<string, { row: NormalizedDisclosure; score: number }>();
  for (const row of candidateRows) {
    const stableKey = buildDisclosureNaturalKeyFromNormalized(
      row.politicianName.trim().toUpperCase(),
      row
    );
    const nextScore = scoreAssetNameQuality(row.assetName);
    const existing = dedupedCandidates.get(stableKey);
    if (!existing || nextScore > existing.score) {
      dedupedCandidates.set(stableKey, { row, score: nextScore });
    }
  }
  normalized.push(...[...dedupedCandidates.values()].map((entry) => entry.row));

  return {
    normalized,
    transactionLikeLineCount,
    candidateCountAfterDedupe: dedupedCandidates.size,
    duplicateCandidatesRemoved: Math.max(0, candidateRows.length - dedupedCandidates.size),
    skipReasons,
    assetFailureReasons,
    suspiciousAssetSamples,
    beforeAfterSamples,
  };
}

async function fetchPdfFromGuesses(urls: string[]): Promise<{
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  buffer: Buffer | null;
}> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const contentType = response.headers.get("content-type");
      const normalizedContentType = (contentType ?? "").toLowerCase();
      if (!normalizedContentType.includes("pdf")) continue;

      const arrayBuffer = await response.arrayBuffer();
      return {
        finalUrl: url,
        status: response.status,
        contentType,
        buffer: Buffer.from(arrayBuffer),
      };
    } catch {
      continue;
    }
  }

  return {
    finalUrl: null,
    status: null,
    contentType: null,
    buffer: null,
  };
}

function normalizeRow(row: HouseRow, year: number): NormalizedDisclosure | null {
  const politicianName = getValue(row, ["filer", "name", "member", "full name"]);
  const assetName = getValue(row, ["asset", "asset name", "description", "issuer"]);
  const tradeDate = parseDate(
    getValue(row, ["transaction date", "trade date", "date", "tx date"])
  );

  if (!politicianName || !assetName || !tradeDate) {
    return null;
  }

  const filingDate = parseDate(getValue(row, ["notification date", "filed", "filing date"]));
  if (!filingDate || !isValidTradingDate(filingDate) || !isValidTradingDate(tradeDate)) {
    return null;
  }

  if (isFutureDate(tradeDate, new Date()) || tradeDate.getTime() > filingDate.getTime()) {
    return null;
  }

  const filingLagDays = Math.floor((filingDate.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24));
  if (filingLagDays < 0) return null;

  const amount = normalizeAmountRange(
    getValue(row, ["amount", "amount range", "amount range label", "value"])
  );

  const resolvedTicker = resolveHouseTicker({
    rawTicker: getValue(row, ["ticker", "symbol"]),
    rawAssetName: assetName,
  });

  const sanitizedTicker = sanitizeParsedText(resolvedTicker.ticker)?.toUpperCase() ?? null;
  const finalTicker = sanitizedTicker && isAllowedTickerToken(sanitizedTicker) ? sanitizedTicker : null;

  return {
    politicianName: sanitizeParsedTextOrEmpty(politicianName),
    party: normalizeParty(getValue(row, ["party"])),
    state: sanitizeParsedText(getValue(row, ["state", "district state", "st"])),
    chamber: "house",
    ticker: finalTicker,
    assetName: sanitizeParsedTextOrEmpty(assetName),
    assetType: inferAssetType(assetName),
    assetCategory: extractAssetCategoryFromText(assetName),
    tradeType: normalizeTradeType(getValue(row, ["type", "transaction type", "tx type"])),
    ownerType: normalizeOwnerType(getValue(row, ["owner", "owner type"])),
    amountRangeLabel: sanitizeParsedText(amount.label),
    amountMin: amount.min,
    amountMax: amount.max,
    tradeDate,
    filingDate,
    filingLagDays,
    sourceUrl: sanitizeParsedText(buildSourceUrl(year, row)),
    sourceLabel: sanitizeParsedTextOrEmpty(HOUSE_SOURCE_LABEL),
    normalizedAssetName: sanitizeParsedTextOrEmpty(resolvedTicker.normalization.canonicalAssetName),
    tickerResolutionSource: resolvedTicker.source,
    debugRawLine: sanitizeParsedText(JSON.stringify(row)),
  };
}

function isTransactionLikeRecord(row: HouseRow): boolean {
  const transactionSignal = getValue(row, [
    "transaction date",
    "trade date",
    "tx date",
    "transaction type",
    "tx type",
    "asset",
    "asset name",
    "description",
    "issuer",
    "amount",
    "amount range",
  ]);
  return Boolean(transactionSignal);
}

function classifyNormalizationFailure(row: HouseRow): NormalizationFailureReason[] {
  const reasons: NormalizationFailureReason[] = [];

  const politicianName = getValue(row, ["filer", "name", "member", "full name"]);
  const assetName = getValue(row, ["asset", "asset name", "description", "issuer"]);
  const tradeDate = parseDate(
    getValue(row, ["transaction date", "trade date", "date", "tx date"])
  );
  const filingDate = parseDate(getValue(row, ["notification date", "filed", "filing date"]));
  const tradeType = getValue(row, ["type", "transaction type", "tx type"]);

  if (!isTransactionLikeRecord(row)) reasons.push("not_transaction_like_record");
  if (!politicianName) reasons.push("missing_politician_name");
  if (!assetName) reasons.push("missing_asset_name");
  if (!tradeDate) reasons.push("missing_trade_date");
  if (!filingDate) reasons.push("missing_filing_date");
  if (!tradeType) reasons.push("missing_trade_type");

  return reasons;
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], {
    maxBuffer: 1024 * 1024 * 50,
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readZipEntry(zipPath: string, entryName: string): Promise<string> {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryName], {
    maxBuffer: 1024 * 1024 * 200,
    encoding: "utf8",
  });
  return stdout;
}

function scoreFileContent(content: string): number {
  const header = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  const hints = ["transaction", "asset", "ticker", "amount", "owner", "date"];
  return hints.filter((hint) => header.includes(hint)).length;
}

async function fetchYearRows(year: number): Promise<YearFetchResult> {
  const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
  const maxAttempts = 3;
  const downloadHeaders = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "application/zip,application/octet-stream,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://disclosures-clerk.house.gov/",
    Connection: "keep-alive",
  };
  console.log(`📥 Downloading ${url}`);

  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(url, { headers: downloadHeaders });
      if (response.ok) {
        break;
      }

      console.warn(
        `⚠️ House zip download failed year=${year} url=${url} status=${response.status} attempt=${attempt}/${maxAttempts}`
      );
    } catch (error) {
      console.warn(
        `⚠️ House zip download error year=${year} url=${url} attempt=${attempt}/${maxAttempts}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (attempt < maxAttempts) {
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.log(`⏳ Retrying year=${year} in ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText}` : "no response";
    throw new Error(`Failed to download ${url} after ${maxAttempts} attempts: ${status}`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "trawl-house-"));
  const zipPath = join(tempDir, `${year}FD.zip`);

  try {
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(zipPath, Buffer.from(arrayBuffer));

    const entries = await listZipEntries(zipPath);
    const candidates = entries.filter((entry) => /\.(txt|csv|tsv)$/i.test(entry));
    const xmlCandidates = entries.filter((entry) => /\.xml$/i.test(entry));

    if (candidates.length === 0) {
      throw new Error(`No delimited text files found in ${year} zip archive.`);
    }

    let bestRows: HouseRow[] = [];
    let bestHeaders: string[] = [];
    let selectedFile: string | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const content = await readZipEntry(zipPath, candidate);
      const parsed = parseDelimited(content);
      const rows = parsed.rows;
      if (rows.length === 0) continue;

      const score = scoreFileContent(content);
      if (score > bestScore || (score === bestScore && rows.length > bestRows.length)) {
        bestScore = score;
        bestRows = rows;
        bestHeaders = parsed.headers;
        selectedFile = candidate;
      }
    }

    let xmlFile: string | null = null;
    let xmlPreview: string | null = null;

    if (xmlCandidates.length > 0) {
      xmlFile = xmlCandidates[0] ?? null;
      if (xmlFile) {
        const xmlContent = await readZipEntry(zipPath, xmlFile);
        xmlPreview = xmlContent.slice(0, 800).replace(/\s+/g, " ").trim();
      }
    }

    return {
      rows: bestRows,
      zipEntries: entries,
      selectedFile,
      selectedHeaders: bestHeaders,
      xmlFile,
      xmlPreview,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getOrCreatePoliticianId(normalized: NormalizedDisclosure): Promise<number> {
  const existing = await db
    .select({ id: politicians.id, state: politicians.state })
    .from(politicians)
    .where(
      and(
        eq(politicians.fullName, normalized.politicianName),
        eq(politicians.chamber, normalized.chamber)
      )
    )
    .limit(1);

  if (existing[0]) {
    if (!existing[0].state && normalized.state) {
      await db.update(politicians).set({ state: normalized.state }).where(eq(politicians.id, existing[0].id));
      console.log(
        `ℹ️ Backfilled politician state: "${normalized.politicianName}" -> "${normalized.state}"`
      );
    }
    return existing[0].id;
  }

  const inserted = await db
    .insert(politicians)
    .values({
      fullName: normalized.politicianName,
      chamber: normalized.chamber,
      // Party is intentionally left as provided by upstream member metadata; House PTR filings do not include party.
      party: normalized.party,
      state: normalized.state,
    })
    .returning({ id: politicians.id });

  return inserted[0].id;
}

async function isDuplicateDisclosure(
  politicianId: number,
  normalized: NormalizedDisclosure
): Promise<boolean> {
  const normalizedNaturalKey = buildDisclosureNaturalKeyFromNormalized(String(politicianId), normalized);
  const existing = await db
    .select({
      id: disclosures.id,
      politicianId: disclosures.politicianId,
      ticker: disclosures.ticker,
      tradeType: disclosures.tradeType,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      amountRangeLabel: disclosures.amountRangeLabel,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.politicianId, politicianId),
        eq(disclosures.tradeType, normalized.tradeType),
        eq(disclosures.tradeDate, normalized.tradeDate),
        normalized.filingDate ? eq(disclosures.filingDate, normalized.filingDate) : isNull(disclosures.filingDate),
        normalized.ticker ? eq(disclosures.ticker, normalized.ticker) : isNull(disclosures.ticker),
        normalized.amountRangeLabel
          ? eq(disclosures.amountRangeLabel, normalized.amountRangeLabel)
          : isNull(disclosures.amountRangeLabel)
      )
    )
    .limit(5);

  return existing.some((row) => buildDisclosureNaturalKeyFromDbRow(row) === normalizedNaturalKey);
}

async function findExistingHouseDisclosureForUpsert(
  politicianId: number,
  normalized: NormalizedDisclosure
): Promise<number | null> {
  const existing = await db
    .select({
      id: disclosures.id,
      politicianId: disclosures.politicianId,
      ticker: disclosures.ticker,
      tradeType: disclosures.tradeType,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
      amountRangeLabel: disclosures.amountRangeLabel,
      assetName: disclosures.assetName,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL),
        eq(disclosures.politicianId, politicianId),
        eq(disclosures.tradeType, normalized.tradeType),
        eq(disclosures.tradeDate, normalized.tradeDate),
        normalized.ticker ? eq(disclosures.ticker, normalized.ticker) : isNull(disclosures.ticker),
        normalized.filingDate
          ? eq(disclosures.filingDate, normalized.filingDate)
          : isNull(disclosures.filingDate),
        normalized.amountRangeLabel
          ? eq(disclosures.amountRangeLabel, normalized.amountRangeLabel)
          : isNull(disclosures.amountRangeLabel)
      )
    )
    .limit(10);

  const targetKey = buildDisclosureNaturalKeyFromNormalized(String(politicianId), normalized);
  const matches = existing.filter((row) => buildDisclosureNaturalKeyFromDbRow(row) === targetKey);
  if (matches.length === 0) return null;

  let bestId = matches[0]!.id;
  let bestScore = scoreAssetNameQuality(matches[0]!.assetName);
  for (const row of matches.slice(1)) {
    const score = scoreAssetNameQuality(row.assetName);
    if (score > bestScore) {
      bestScore = score;
      bestId = row.id;
    }
  }

  return bestId;
}

function chunkArray<T>(entries: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [entries];

  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(entries.slice(index, index + chunkSize));
  }
  return chunks;
}

function sanitizeDisclosureForImport(row: NormalizedDisclosure): NormalizedDisclosure {
  const sanitizedTicker = sanitizeParsedText(row.ticker)?.toUpperCase() ?? null;
  const normalizedAssetCategory =
    row.assetCategory && row.assetCategory !== "unknown"
      ? row.assetCategory
      : extractAssetCategoryFromText(`${row.assetName} ${row.debugRawLine ?? ""}`);
  return {
    ...row,
    politicianName: sanitizeParsedTextOrEmpty(row.politicianName),
    ticker: sanitizedTicker && isAllowedTickerToken(sanitizedTicker) ? sanitizedTicker : null,
    assetName: sanitizeParsedTextOrEmpty(row.assetName),
    ownerType: sanitizeParsedTextOrEmpty(row.ownerType) as NormalizedDisclosure["ownerType"],
    tradeType: sanitizeParsedTextOrEmpty(row.tradeType) as NormalizedDisclosure["tradeType"],
    amountRangeLabel: sanitizeParsedText(row.amountRangeLabel),
    sourceUrl: sanitizeParsedText(row.sourceUrl),
    sourceLabel: sanitizeParsedTextOrEmpty(row.sourceLabel),
    normalizedAssetName: sanitizeParsedTextOrEmpty(row.normalizedAssetName),
    assetCategory: normalizedAssetCategory,
    debugRawLine: sanitizeParsedText(row.debugRawLine),
    party: sanitizeParsedText(row.party),
    state: sanitizeParsedText(row.state),
  };
}

function buildDisclosureNaturalKeyFromNormalized(
  politicianKey: string,
  normalized: Pick<
    NormalizedDisclosure,
    "ticker" | "tradeType" | "tradeDate" | "filingDate" | "amountRangeLabel"
  >
): string {
  const tradeDate = normalized.tradeDate.toISOString().slice(0, 10);
  const filingDate = normalized.filingDate ? normalized.filingDate.toISOString().slice(0, 10) : "null";
  return [
    politicianKey,
    normalized.ticker ?? "null",
    normalized.tradeType,
    tradeDate,
    filingDate,
    normalized.amountRangeLabel ?? "null",
  ].join("::");
}

function buildDisclosureNaturalKeyFromDbRow(row: {
  politicianId: number;
  ticker: string | null;
  tradeType: string;
  tradeDate: Date | null;
  filingDate: Date | null;
  amountRangeLabel: string | null;
}): string | null {
  if (!(row.tradeDate instanceof Date)) return null;
  const filingDate = row.filingDate instanceof Date ? row.filingDate.toISOString().slice(0, 10) : "null";
  return [
    row.politicianId,
    row.ticker?.trim().toUpperCase() ?? "null",
    row.tradeType,
    row.tradeDate.toISOString().slice(0, 10),
    filingDate,
    row.amountRangeLabel ?? "null",
  ].join("::");
}

async function resetHouseImportedRowsForLocalDev(): Promise<void> {
  const houseDisclosureRows = await db
    .select({ id: disclosures.id })
    .from(disclosures)
    .where(eq(disclosures.sourceLabel, HOUSE_SOURCE_LABEL));

  const houseDisclosureIds = houseDisclosureRows.map((row) => row.id);
  if (houseDisclosureIds.length === 0) {
    console.log("♻️ RESET_HOUSE_IMPORT requested, but no House disclosures were found.");
    return;
  }

  const houseSignalRows = await db
    .select({ id: researchSignals.id })
    .from(researchSignals)
    .where(inArray(researchSignals.disclosureId, houseDisclosureIds));
  const houseSignalIds = houseSignalRows.map((row) => row.id);

  for (const batch of chunkArray(houseSignalIds, 1000)) {
    await db.delete(alerts).where(inArray(alerts.researchSignalId, batch));
  }

  for (const batch of chunkArray(houseDisclosureIds, 1000)) {
    await db
      .delete(alerts)
      .where(
        or(
          inArray(alerts.disclosureId, batch),
          inArray(alerts.researchSignalId, houseSignalIds.length > 0 ? houseSignalIds : [-1])
        )
      );
  }

  for (const batch of chunkArray(houseSignalIds, 1000)) {
    await db.delete(researchSignals).where(inArray(researchSignals.id, batch));
  }

  for (const batch of chunkArray(houseDisclosureIds, 1000)) {
    await db
      .delete(disclosurePerformanceWindows)
      .where(inArray(disclosurePerformanceWindows.disclosureId, batch));
  }

  for (const batch of chunkArray(houseDisclosureIds, 1000)) {
    await db.delete(disclosures).where(inArray(disclosures.id, batch));
  }

  console.log(
    `♻️ RESET_HOUSE_IMPORT complete. Deleted ${houseDisclosureIds.length} House disclosures and ${houseSignalIds.length} dependent research signals.`
  );
}

async function cleanupHouseDisclosureDuplicates(): Promise<void> {
  const duplicateGroups = await db.execute(sql`
    with duplicate_groups as (
      select
        d.politician_id,
        upper(coalesce(d.ticker, 'NULL')) as ticker_key,
        d.trade_type,
        d.trade_date::date as trade_date_key,
        d.filing_date::date as filing_date_key,
        coalesce(d.amount_range_label, 'NULL') as amount_key,
        array_agg(d.id order by d.id asc) as disclosure_ids,
        count(*) as duplicate_count
      from disclosures d
      where d.source_label = ${HOUSE_SOURCE_LABEL}
      group by
        d.politician_id,
        upper(coalesce(d.ticker, 'NULL')),
        d.trade_type,
        d.trade_date::date,
        d.filing_date::date,
        coalesce(d.amount_range_label, 'NULL')
      having count(*) > 1
    )
    select disclosure_ids from duplicate_groups;
  `);

  const groups = duplicateGroups.rows as Array<{ disclosure_ids: number[] }>;
  if (groups.length === 0) {
    console.log("🧹 Duplicate cleanup skipped: no duplicate House disclosure groups found.");
    return;
  }

  let deletedDisclosures = 0;
  let deletedSignals = 0;
  let deletedPerformanceRows = 0;

  for (const group of groups) {
    const ids = group.disclosure_ids;
    if (!Array.isArray(ids) || ids.length <= 1) continue;

    const disclosureRows = await db
      .select({ id: disclosures.id, assetName: disclosures.assetName })
      .from(disclosures)
      .where(inArray(disclosures.id, ids));

    let keepId = disclosureRows[0]?.id;
    let keepScore = scoreAssetNameQuality(disclosureRows[0]?.assetName ?? "");
    for (const row of disclosureRows.slice(1)) {
      const score = scoreAssetNameQuality(row.assetName);
      if (score > keepScore) {
        keepScore = score;
        keepId = row.id;
      }
    }

    const removeIds = ids.filter((id) => id !== keepId);
    if (removeIds.length === 0) continue;

    const signalRows = await db
      .select({ id: researchSignals.id })
      .from(researchSignals)
      .where(inArray(researchSignals.disclosureId, removeIds));
    const signalIds = signalRows.map((row) => row.id);

    for (const batch of chunkArray(signalIds, 1000)) {
      if (batch.length === 0) continue;
      await db.delete(alerts).where(inArray(alerts.researchSignalId, batch));
      await db.delete(researchSignals).where(inArray(researchSignals.id, batch));
      deletedSignals += batch.length;
    }

    for (const batch of chunkArray(removeIds, 1000)) {
      if (batch.length === 0) continue;
      await db.delete(alerts).where(inArray(alerts.disclosureId, batch));
      await db
        .delete(disclosurePerformanceWindows)
        .where(inArray(disclosurePerformanceWindows.disclosureId, batch));
      await db.delete(disclosures).where(inArray(disclosures.id, batch));
      deletedDisclosures += batch.length;
      deletedPerformanceRows += batch.length;
    }
  }

  console.log(
    `🧹 Duplicate cleanup complete. Deleted duplicate disclosures=${deletedDisclosures}, research_signals=${deletedSignals}, performance_rows≈${deletedPerformanceRows}.`
  );
}

async function importNormalizedDisclosures(rows: NormalizedDisclosure[]): Promise<ImportStats> {
  const debugHouseImport = process.env.DEBUG_HOUSE_IMPORT === "true";
  const maxRejectedSampleLogs = debugHouseImport ? 20 : 3;
  const maxAcceptedSampleLogs = debugHouseImport ? 20 : 3;
  const maxStValidationLogs = debugHouseImport ? 50 : 0;
  const maxRejectedStSamplesPerReason = debugHouseImport ? 30 : 0;
  const stats: ImportStats = {
    inserted: 0,
    updated: 0,
    skippedUnchanged: 0,
    skippedInvalid: 0,
    rejectionReasons: new Map<ImportRejectedReason, number>(),
    acceptedByAssetCategory: new Map(),
    rejectedByAssetCategory: new Map(),
  };
  let rejectedLogCount = 0;
  let acceptedLogCount = 0;
  const rejectedStSamplesByReason = new Map<ImportRejectedReason, string[]>();
  let stDebugLogCount = 0;

  const incrementRejectReason = (reason: ImportRejectedReason) => {
    stats.rejectionReasons.set(reason, (stats.rejectionReasons.get(reason) ?? 0) + 1);
  };

  const now = new Date();
  const totalRows = rows.length;
  let processedRows = 0;
  const logProgressIfNeeded = () => {
    if (processedRows % 250 !== 0) return;
    console.log(
      `📈 Import progress: processed=${processedRows}/${totalRows}, inserted=${stats.inserted}, updated=${stats.updated}, rejected=${stats.skippedInvalid}, skipped=${stats.skippedUnchanged}`
    );
  };

  for (const rawRow of rows) {
    processedRows += 1;
    const row = sanitizeDisclosureForImport(rawRow);
    const tradeDate = row.tradeDate;
    const filingDate = row.filingDate;
    const unsupportedReason = getUnsupportedAssetReason(
      row.assetName,
      row.debugRawLine ?? null,
      row.assetCategory,
      row.assetType
    );
    const isUnsupportedAsset = unsupportedReason !== null;
    const hasTicker = Boolean(row.ticker);
    const isStockCategory = row.assetCategory === "ST";
    const hasValidTradeDate = tradeDate instanceof Date && isValidTradingDate(tradeDate);
    const hasValidFilingDate = filingDate instanceof Date && isValidTradingDate(filingDate);
    const isFutureTrade = hasValidTradeDate ? isFutureDate(tradeDate, now) : false;
    const isTradeAfterFiling = hasValidTradeDate && hasValidFilingDate ? tradeDate.getTime() > filingDate.getTime() : false;
    const isValid =
      isStockCategory &&
      hasTicker &&
      hasValidTradeDate &&
      hasValidFilingDate &&
      !isFutureTrade &&
      !isTradeAfterFiling &&
      !isUnsupportedAsset;

    let reason: ImportRejectedReason | null = null;

    if (!hasTicker) {
      reason = "missing ticker";
    } else if (!isStockCategory || isUnsupportedAsset) {
      reason = "non-stock/unsupported asset";
    } else if (!hasValidTradeDate) {
      reason = "invalid trade date";
    } else if (!hasValidFilingDate) {
      reason = "missing filing date";
    } else if (isFutureTrade) {
      reason = "future trade date";
    } else if (isTradeAfterFiling) {
      reason = "trade date after filing date";
    }

    if (!reason && !isValid) {
      reason = "non-stock/unsupported asset";
    }

    if (isStockCategory && stDebugLogCount < maxStValidationLogs) {
      console.log(
        `🧪 ST validation sample[${stDebugLogCount + 1}] raw="${row.debugRawLine ?? "(none)"}" assetName="${row.assetName}" ticker="${row.ticker ?? "null"}" assetCategory="${row.assetCategory}" assetType="${row.assetType}" unsupportedReason="${unsupportedReason ?? "null"}" finalReason="${reason ?? "accepted"}" isUnsupportedAsset=${isUnsupportedAsset} hasTicker=${hasTicker} validTradeDate=${hasValidTradeDate} validFilingDate=${hasValidFilingDate} tradeDateLeqFilingDate=${hasValidTradeDate && hasValidFilingDate ? String(!isTradeAfterFiling) : "false"}`
      );
      stDebugLogCount += 1;
    }

    if (
      debugHouseImport &&
      isStockCategory &&
      hasTicker &&
      hasValidTradeDate &&
      hasValidFilingDate &&
      !isTradeAfterFiling &&
      unsupportedReason === null &&
      reason !== null
    ) {
      console.log(
        `🚨 ST debug assertion failed: row should be valid but is not. unsupportedReason="${unsupportedReason ?? "null"}" raw="${row.debugRawLine ?? "(none)"}" assetName="${row.assetName}" ticker="${row.ticker ?? "null"}" assetType="${row.assetType}" finalReason="${reason ?? "null"}"`
      );
    }

    if (reason) {
      stats.skippedInvalid += 1;
      incrementRejectReason(reason);
      stats.rejectedByAssetCategory.set(
        row.assetCategory,
        (stats.rejectedByAssetCategory.get(row.assetCategory) ?? 0) + 1
      );

      if (rejectedLogCount < maxRejectedSampleLogs) {
        console.log(
          `⚠️ Rejected row[${rejectedLogCount + 1}] reason="${reason}" raw="${row.debugRawLine ?? "(none)"}" parsedTicker="${row.ticker ?? "null"}" parsedAsset="${row.assetName}" parsedTradeDate="${tradeDate instanceof Date ? tradeDate.toISOString().slice(0, 10) : "null"}" filingDate="${filingDate instanceof Date ? filingDate.toISOString().slice(0, 10) : "null"}" owner="${row.ownerType}" tradeType="${row.tradeType}"`
        );
        rejectedLogCount += 1;
      }
      if (row.assetCategory === "ST" && maxRejectedStSamplesPerReason > 0) {
        const existing = rejectedStSamplesByReason.get(reason) ?? [];
        if (existing.length < maxRejectedStSamplesPerReason) {
          existing.push(
            `⚠️ Rejected ST sample[${existing.length + 1}] reason="${reason}" raw="${row.debugRawLine ?? "(none)"}" assetName="${row.assetName}" assetCategory="${row.assetCategory}" ticker="${row.ticker ?? "null"}" assetType="${row.assetType}" unsupportedReason="${unsupportedReason ?? "null"}" tradeType="${row.tradeType}" tradeDate="${tradeDate instanceof Date ? tradeDate.toISOString().slice(0, 10) : "null"}" filingDate="${filingDate instanceof Date ? filingDate.toISOString().slice(0, 10) : "null"}"`
          );
          rejectedStSamplesByReason.set(reason, existing);
        }
      }

      logProgressIfNeeded();
      continue;
    }

    const validTradeDate = tradeDate as Date;
    const validFilingDate = filingDate as Date;

    const filingLagDays = Math.floor(
      (validFilingDate.getTime() - validTradeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (filingLagDays < 0) {
      stats.skippedInvalid += 1;
      incrementRejectReason("trade date after filing date");
      logProgressIfNeeded();
      continue;
    }

    row.filingLagDays = filingLagDays;

    const validRow = {
      ...row,
      tradeDate: validTradeDate,
      filingDate: validFilingDate,
      filingLagDays,
    };

    const politicianId = await getOrCreatePoliticianId(validRow);
    const duplicate = await isDuplicateDisclosure(politicianId, validRow);

    if (duplicate) {
      stats.skippedUnchanged += 1;
      incrementRejectReason("duplicate");
      stats.rejectedByAssetCategory.set(
        row.assetCategory,
        (stats.rejectedByAssetCategory.get(row.assetCategory) ?? 0) + 1
      );

      if (rejectedLogCount < maxRejectedSampleLogs) {
        console.log(
          `⚠️ Rejected row[${rejectedLogCount + 1}] reason="duplicate" raw="${row.debugRawLine ?? "(none)"}" parsedTicker="${row.ticker ?? "null"}" parsedAsset="${row.assetName}" parsedTradeDate="${validTradeDate.toISOString().slice(0, 10)}" filingDate="${validFilingDate.toISOString().slice(0, 10)}" owner="${row.ownerType}" tradeType="${row.tradeType}"`
        );
        rejectedLogCount += 1;
      }

      logProgressIfNeeded();
      continue;
    }

    if (acceptedLogCount < maxAcceptedSampleLogs) {
      console.log(
        `✅ Accepted row[${acceptedLogCount + 1}] raw="${row.debugRawLine ?? "(none)"}" parsedTicker="${row.ticker ?? "null"}" parsedAsset="${row.assetName}" parsedTradeDate="${validTradeDate.toISOString().slice(0, 10)}" filingDate="${validFilingDate.toISOString().slice(0, 10)}" owner="${row.ownerType}" tradeType="${row.tradeType}"`
      );
      acceptedLogCount += 1;
    }
    stats.acceptedByAssetCategory.set(
      row.assetCategory,
      (stats.acceptedByAssetCategory.get(row.assetCategory) ?? 0) + 1
    );

    const existingHouseDisclosureId = await findExistingHouseDisclosureForUpsert(
      politicianId,
      validRow
    );

    if (existingHouseDisclosureId) {
      await db
        .update(disclosures)
        .set({
          ticker: validRow.ticker,
          assetType: validRow.assetType,
          ownerType: validRow.ownerType,
          amountRangeLabel: validRow.amountRangeLabel,
          amountMin: validRow.amountMin,
          amountMax: validRow.amountMax,
          filingLagDays,
          sourceUrl: validRow.sourceUrl,
          sourceLabel: validRow.sourceLabel,
          updatedAt: new Date(),
        })
        .where(eq(disclosures.id, existingHouseDisclosureId));

      stats.updated += 1;
    } else {
      await db.insert(disclosures).values({
        politicianId,
        ticker: validRow.ticker,
        assetName: validRow.assetName,
        assetType: validRow.assetType,
        tradeType: validRow.tradeType,
        ownerType: validRow.ownerType,
        amountRangeLabel: validRow.amountRangeLabel,
        amountMin: validRow.amountMin,
        amountMax: validRow.amountMax,
        tradeDate: validTradeDate,
        filingDate: validFilingDate,
        filingLagDays,
        sourceUrl: validRow.sourceUrl,
        sourceLabel: validRow.sourceLabel,
        updatedAt: new Date(),
      });

      stats.inserted += 1;
    }

    logProgressIfNeeded();
  }

  if (debugHouseImport) {
    for (const [reason, samples] of rejectedStSamplesByReason.entries()) {
      if (samples.length === 0) continue;
      console.log(`🧪 Rejected ST sample rows for reason="${reason}" (showing ${samples.length}):`);
      for (const sample of samples) {
        console.log(sample);
      }
    }
  }

  return stats;
}

async function main() {
  const years = parseYearsArg();
  const shouldResetBeforeImport = process.env.RESET_HOUSE_IMPORT === "true";
  const shouldCleanupDuplicates = process.argv.slice(2).includes("--cleanup-duplicates");
  const continueOnYearFailure =
    process.argv.slice(2).includes("--continue-on-year-failure") ||
    process.argv.slice(2).includes("--daily-mode");
  const mode: ImportMode = continueOnYearFailure ? "daily" : "manual";

  if (years.length === 0) {
    throw new Error("No valid years provided. Use --years=2026 or similar.");
  }

  console.log(`🏛️ House import started for year(s): ${years.join(", ")}`);
  console.log(`🧭 Import mode: ${mode}`);
  console.log(`🧪 RESET_HOUSE_IMPORT=${shouldResetBeforeImport ? "enabled" : "disabled"}`);

  if (shouldResetBeforeImport) {
    await resetHouseImportedRowsForLocalDev();
  }

  const normalizedRows: NormalizedDisclosure[] = [];
  const failureReasonCounts = new Map<NormalizationFailureReason, number>();
  const tickerResolutionCounts = new Map<TickerResolutionSource, number>();
  const unresolvedAssetCounts = new Map<string, number>();
  const filingsDiscoveredByYear = new Map<number, number>();
  let pdfsAttempted = 0;
  let pdfsDownloaded = 0;
  let pdfsWithExtractedText = 0;
  let parsedTransactionRows = 0;
  let transactionCandidatesBeforeNormalization = 0;
  let transactionCandidatesAfterDedupe = 0;
  let duplicateCandidatesRemoved = 0;
  let parseFailureCount = 0;
  let rejectedRows = 0;
  let ptrTextStructureDebugLogged = 0;
  const ptrCandidateCountByPdf: Array<{ year: number; docId: string; count: number }> = [];
  const yearsAttempted: number[] = [];
  const yearsSucceeded: number[] = [];
  const yearsFailed: number[] = [];

  for (const year of years) {
    yearsAttempted.push(year);
    let fetchResult: YearFetchResult;
    try {
      fetchResult = await fetchYearRows(year);
    } catch (error) {
      yearsFailed.push(year);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to fetch House archive for year=${year}: ${message}`);
      if (!continueOnYearFailure) {
        throw error;
      }
      console.warn(`⚠️ Continuing import after year failure because mode=${mode} year=${year}`);
      continue;
    }
    yearsSucceeded.push(year);

    const sourceRows = fetchResult.rows;
    console.log(`📄 ${year}: parsed ${sourceRows.length} source rows.`);
    console.log(`🧭 ${year}: ZIP entries discovered (${fetchResult.zipEntries.length}):`);
    for (const entry of fetchResult.zipEntries) {
      console.log(`   - ${entry}`);
    }
    console.log(`🧪 ${year}: selected file for parsing: ${fetchResult.selectedFile ?? "(none)"}`);
    console.log(`🧪 ${year}: parsed headers: ${fetchResult.selectedHeaders.join(" | ")}`);
    if (fetchResult.xmlFile) {
      const preview = fetchResult.xmlPreview ?? "";
      const hasDocId = /docid/i.test(preview);
      const hasFilingType = /filingtype/i.test(preview);
      console.log(`🧪 ${year}: xml file available for lightweight inspection: ${fetchResult.xmlFile}`);
      console.log(`🧪 ${year}: xml preview contains DocID=${hasDocId}, FilingType=${hasFilingType}`);
    } else {
      console.log(`🧪 ${year}: no xml file found in archive.`);
    }
    console.log(`🧪 ${year}: first ${Math.min(10, sourceRows.length)} source rows:`);
    sourceRows.slice(0, 10).forEach((row, index) => {
      console.log(`   [${index + 1}] ${JSON.stringify(row)}`);
    });

    const filingTypeP = sourceRows.filter(
      (row) => (getRowFilingType(row) ?? "").trim().toUpperCase() === "P"
    );
    filingsDiscoveredByYear.set(year, filingTypeP.length);

    console.log(`🧪 ${year}: FilingType=P rows: ${filingTypeP.length}`);
    console.log(`🧪 ${year}: PTR candidate preview count: ${Math.min(5, filingTypeP.length)}`);
    filingTypeP.slice(0, 5).forEach((row, index) => {
      const summary = {
        Prefix: row.Prefix ?? row.prefix ?? "",
        Last: row.Last ?? row.last ?? "",
        First: row.First ?? row.first ?? "",
        FilingType: getRowFilingType(row),
        FilingDate: getValue(row, ["filing date", "filingdate", "filed"]),
        DocID: getRowDocId(row),
      };
      console.log(`   🔎 Candidate[${index + 1}] ${JSON.stringify(summary)}`);
    });

    let ptrPdfProcessed = 0;
    let ptrPdfExtracted = 0;
    let ptrTransactionLikeLines = 0;
    let ptrTransactionAfterDedupe = 0;
    let ptrDuplicateCandidatesRemoved = 0;
    let ptrNormalizedRows = 0;
    const ptrSkipReasons = new Map<PtrRowSkipReason, number>();
    const ptrAssetFailureReasons = new Map<PtrAssetParseFailureReason, number>();
    const ptrSuspiciousAssetSamples: PtrSuspiciousAssetSample[] = [];
    const ptrBeforeAfterSamples: PtrBeforeAfterSample[] = [];

    for (const [index, row] of filingTypeP.entries()) {
      const docId = getRowDocId(row);
      if (!docId) {
        console.log(`   📄 Candidate[${index + 1}] has no DocID; skipping PDF extraction.`);
        continue;
      }
      pdfsAttempted += 1;
      ptrPdfProcessed += 1;

      const guessedUrls = buildDocumentUrlGuesses(year, docId);
      const pdfFetch = await fetchPdfFromGuesses(guessedUrls);

      if (!pdfFetch.buffer || !pdfFetch.finalUrl) {
        console.log(`   📄 Candidate[${index + 1}] DocID=${docId} fetch result: PDF unavailable`);
        continue;
      }
      pdfsDownloaded += 1;

      const extraction = await extractPdfTextBuffer(pdfFetch.buffer);
      const extractedText = extraction.text;
      const textPreview = (extractedText ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 320)
        .trim();
      const shouldLogPdfDebug = index < 3;
      console.log(
        `   📄 Candidate[${index + 1}] DocID=${docId} fetch result: status=${pdfFetch.status} content-type=${pdfFetch.contentType ?? "(unknown)"}`
      );
      console.log(
        `      extraction: ${extractedText ? "success" : "failed"} pages=${extraction.pageCount} text-length=${extractedText?.length ?? 0} preview="${textPreview || "(empty)"}"`
      );
      if (shouldLogPdfDebug) {
        console.log(
          `      debug: bytes=${pdfFetch.buffer.byteLength} getDocument=${extraction.error ? "failed" : "ok"} numPages=${extraction.pageCount}`
        );
        if (extraction.pageItemCounts.length > 0) {
          console.log(
            `      debug: per-page text item counts=${extraction.pageItemCounts.join(", ")}`
          );
        }
        if (extraction.error) {
          console.log(`      debug: pdfjs error=${extraction.error}`);
        }
      }

      if (!extractedText) {
        continue;
      }
      pdfsWithExtractedText += 1;
      ptrPdfExtracted += 1;

      if (ptrTextStructureDebugLogged < 5) {
        const debugLines = extractedText
          .split(/\r?\n/)
          .map(normalizePtrLine)
          .filter(Boolean);
        const first80 = debugLines.slice(0, 80);
        const interestingPatterns = [
          /Purchase/i,
          /Sale/i,
          /Exchange/i,
          /\bP\b/,
          /\bS\b/,
          /\bE\b/,
          /\$1,001/i,
          /\$15,000/i,
        ];
        const matching = debugLines.filter((line) => interestingPatterns.some((pattern) => pattern.test(line)));
        console.log(`🧪 PTR text structure sample[${ptrTextStructureDebugLogged + 1}] DocID=${docId}`);
        console.log(`   first 80 non-empty lines (showing ${first80.length}):`);
        first80.forEach((line, lineIndex) => {
          console.log(`   [${lineIndex + 1}] ${line}`);
        });
        console.log(`   lines matching transaction/amount hints (showing ${Math.min(40, matching.length)}):`);
        matching.slice(0, 40).forEach((line, lineIndex) => {
          console.log(`   [${lineIndex + 1}] ${line}`);
        });
        ptrTextStructureDebugLogged += 1;
      }

      const parsed = parsePtrTransactionsFromPdfText({
        text: extractedText,
        sourceRow: row,
        sourceUrl: pdfFetch.finalUrl,
      });

      transactionCandidatesBeforeNormalization += parsed.transactionLikeLineCount;
      transactionCandidatesAfterDedupe += parsed.candidateCountAfterDedupe;
      duplicateCandidatesRemoved += parsed.duplicateCandidatesRemoved;
      ptrTransactionLikeLines += parsed.transactionLikeLineCount;
      ptrTransactionAfterDedupe += parsed.candidateCountAfterDedupe;
      ptrDuplicateCandidatesRemoved += parsed.duplicateCandidatesRemoved;
      ptrNormalizedRows += parsed.normalized.length;
      parseFailureCount += Math.max(0, parsed.transactionLikeLineCount - parsed.normalized.length);

      parsed.skipReasons.forEach((count, reason) => {
        ptrSkipReasons.set(reason, (ptrSkipReasons.get(reason) ?? 0) + count);
      });
      parsed.assetFailureReasons.forEach((count, reason) => {
        ptrAssetFailureReasons.set(reason, (ptrAssetFailureReasons.get(reason) ?? 0) + count);
      });
      for (const sample of parsed.suspiciousAssetSamples) {
        if (ptrSuspiciousAssetSamples.length >= 8) break;
        ptrSuspiciousAssetSamples.push(sample);
      }
      for (const sample of parsed.beforeAfterSamples) {
        if (ptrBeforeAfterSamples.length >= 6) break;
        ptrBeforeAfterSamples.push(sample);
      }
      normalizedRows.push(...parsed.normalized);
      parsedTransactionRows += parsed.normalized.length;
      ptrCandidateCountByPdf.push({
        year,
        docId,
        count: parsed.transactionLikeLineCount,
      });

      console.log(
        `      reconstructed candidates before dedupe=${parsed.transactionLikeLineCount}, after dedupe=${parsed.candidateCountAfterDedupe}, duplicate candidates removed=${parsed.duplicateCandidatesRemoved}, normalized disclosures=${parsed.normalized.length}`
      );
    }

    console.log(
      `🧪 ${year}: PTR PDFs processed=${ptrPdfProcessed}, extraction succeeded=${ptrPdfExtracted}, reconstructed candidates before dedupe=${ptrTransactionLikeLines}, after dedupe=${ptrTransactionAfterDedupe}, duplicate candidates removed=${ptrDuplicateCandidatesRemoved}, normalized disclosures=${ptrNormalizedRows}`
    );
    if (ptrSkipReasons.size > 0) {
      console.log(`🧪 ${year}: top PTR row skip reasons:`);
      for (const [reason, count] of [...ptrSkipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        console.log(`   - ${reason}: ${count}`);
      }
    }
    if (ptrAssetFailureReasons.size > 0) {
      console.log(`🧪 ${year}: top PTR asset-name parse failure reasons:`);
      for (const [reason, count] of [...ptrAssetFailureReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)) {
        console.log(`   - ${reason}: ${count}`);
      }
    }
    if (ptrSuspiciousAssetSamples.length > 0) {
      console.log(`🧪 ${year}: sample suspicious PTR rows with amount-like asset names:`);
      ptrSuspiciousAssetSamples.slice(0, 5).forEach((sample, idx) => {
        console.log(
          `   [${idx + 1}] reason=${sample.reason} extracted="${sample.extractedAssetName}" fallback="${sample.fallbackAssetName ?? "(none)"}" line="${sample.line}"`
        );
      });
    }
    if (ptrBeforeAfterSamples.length > 0) {
      console.log(`🧪 ${year}: sample PTR asset extraction before/after fixes:`);
      ptrBeforeAfterSamples.slice(0, 5).forEach((sample, idx) => {
        console.log(`   [${idx + 1}] before="${sample.before}" after="${sample.after}"`);
      });
    }

    for (const sourceRow of sourceRows) {
      const normalized = normalizeRow(sourceRow, year);
      if (!normalized) {
        rejectedRows += 1;
        parseFailureCount += 1;
        const reasons = classifyNormalizationFailure(sourceRow);
        for (const reason of reasons) {
          failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
        }
        continue;
      }
      normalizedRows.push(normalized);
      parsedTransactionRows += 1;
    }
  }

  if (yearsSucceeded.length === 0) {
    throw new Error(
      `All requested years failed to fetch in mode=${mode}. attempted=${yearsAttempted.join(", ")} failed=${yearsFailed.join(", ")}`
    );
  }

  for (const row of normalizedRows) {
    tickerResolutionCounts.set(
      row.tickerResolutionSource,
      (tickerResolutionCounts.get(row.tickerResolutionSource) ?? 0) + 1
    );
    if (row.tickerResolutionSource === "unresolved") {
      unresolvedAssetCounts.set(
        row.normalizedAssetName,
        (unresolvedAssetCounts.get(row.normalizedAssetName) ?? 0) + 1
      );
    }
  }

  console.log(`🧪 Normalized ${normalizedRows.length} disclosure row(s).`);
  console.log(`🧪 Rejected ${rejectedRows} row(s) during normalization.`);
  console.log("🧪 Import-stage counters:");
  console.log("   - filings discovered by year:");
  for (const [year, count] of [...filingsDiscoveredByYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`     • ${year}: ${count}`);
  }
  console.log(`   - PDFs attempted: ${pdfsAttempted}`);
  console.log(`   - PDFs successfully downloaded: ${pdfsDownloaded}`);
  console.log(`   - PDFs with extracted text: ${pdfsWithExtractedText}`);
  console.log(`   - parsed transaction rows (before normalization): ${transactionCandidatesBeforeNormalization}`);
  console.log(`   - parsed transaction rows (after candidate dedupe): ${transactionCandidatesAfterDedupe}`);
  console.log(`   - duplicate PTR candidates removed pre-normalization: ${duplicateCandidatesRemoved}`);
  console.log(`   - parsed transaction rows: ${parsedTransactionRows}`);
  console.log(`   - parse failures: ${parseFailureCount}`);
  if (ptrCandidateCountByPdf.length > 0) {
    const counts = ptrCandidateCountByPdf.map((entry) => entry.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const avg = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    console.log(
      `   - PTR candidates per PDF: min=${min}, max=${max}, avg=${avg.toFixed(2)} across ${ptrCandidateCountByPdf.length} PDFs`
    );
    console.log("   - top 10 PDFs by PTR candidate count:");
    for (const entry of [...ptrCandidateCountByPdf].sort((a, b) => b.count - a.count).slice(0, 10)) {
      console.log(`     • ${entry.year}/${entry.docId}: ${entry.count}`);
    }
  }
  console.log("🧪 Normalization failure reasons:");
  for (const [reason, count] of [...failureReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${reason}: ${count}`);
  }
  console.log("🧪 Ticker resolution diagnostics:");
  console.log(`   - explicit: ${tickerResolutionCounts.get("explicit") ?? 0}`);
  console.log(`   - mapping: ${tickerResolutionCounts.get("mapping") ?? 0}`);
  console.log(`   - pattern: ${tickerResolutionCounts.get("pattern") ?? 0}`);
  console.log(`   - unresolved: ${tickerResolutionCounts.get("unresolved") ?? 0}`);
  console.log("🧪 Top unresolved normalized asset names:");
  for (const [asset, count] of [...unresolvedAssetCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   - ${asset}: ${count}`);
  }

  const stats = await importNormalizedDisclosures(normalizedRows);
  if (shouldCleanupDuplicates) {
    await cleanupHouseDisclosureDuplicates();
  }
  const totalRejectedByValidationAndDuplicate =
    [...stats.rejectionReasons.entries()].reduce((sum, [, count]) => sum + count, 0) + parseFailureCount;

  console.log("🧪 Rows rejected by reason:");
  const reasonOrder: ImportRejectedReason[] = [
    "missing ticker",
    "invalid trade date",
    "trade date after filing date",
    "future trade date",
    "missing filing date",
    "duplicate",
    "non-stock/unsupported asset",
    "parse failure",
  ];
  for (const reason of reasonOrder) {
    const count = (stats.rejectionReasons.get(reason) ?? 0) + (reason === "parse failure" ? parseFailureCount : 0);
    console.log(`   - ${reason}: ${count}`);
  }
  console.log("🧪 Accepted rows by asset category:");
  for (const category of ["ST", "OT", "PS", "GS", "CS", "unknown"] as const) {
    console.log(`   - ${category}: ${stats.acceptedByAssetCategory.get(category) ?? 0}`);
  }
  console.log("🧪 Rejected rows by asset category:");
  for (const category of ["ST", "OT", "PS", "GS", "CS", "unknown"] as const) {
    console.log(`   - ${category}: ${stats.rejectedByAssetCategory.get(category) ?? 0}`);
  }
  console.log(
    `🧪 PTR parsed rows before dedupe vs after dedupe vs after normalization: before=${transactionCandidatesBeforeNormalization}, after_dedupe=${transactionCandidatesAfterDedupe}, after_normalization=${parsedTransactionRows}`
  );
  console.log(`🧪 rows inserted: ${stats.inserted}`);
  console.log(`🧪 rows updated: ${stats.updated}`);
  console.log(`🧪 rows skipped as exact duplicates: ${stats.skippedUnchanged}`);
  console.log("🧪 Import volume loss checkpoints:");
  const discoveredFilingsTotal = [...filingsDiscoveredByYear.values()].reduce((sum, value) => sum + value, 0);
  console.log(`   - discovery: ${discoveredFilingsTotal}`);
  console.log(`   - PDF download: attempted=${pdfsAttempted}, downloaded=${pdfsDownloaded}`);
  console.log(`   - text extraction: with_text=${pdfsWithExtractedText}`);
  console.log(`   - row parsing: parsed_transaction_rows=${parsedTransactionRows}`);
  console.log(`   - validation rejection: ${totalRejectedByValidationAndDuplicate - (stats.rejectionReasons.get("duplicate") ?? 0)}`);
  console.log(`   - duplicate skipping: ${stats.rejectionReasons.get("duplicate") ?? 0}`);
  console.log("🧾 House year import summary:");
  console.log(`   - years attempted: ${yearsAttempted.join(", ")}`);
  console.log(`   - years succeeded: ${yearsSucceeded.length > 0 ? yearsSucceeded.join(", ") : "(none)"}`);
  console.log(`   - years failed: ${yearsFailed.length > 0 ? yearsFailed.join(", ") : "(none)"}`);
  console.log(`   - rows processed: ${normalizedRows.length}`);
  console.log(`   - rows imported (inserted + updated): ${stats.inserted + stats.updated}`);
  if (yearsFailed.length > 0 && continueOnYearFailure) {
    console.warn(
      `⚠️ House import completed with partial year failures in mode=${mode}. failed_years=${yearsFailed.join(", ")}`
    );
  }

  console.log(
    `✅ Import done. Inserted ${stats.inserted}, updated ${stats.updated}, skipped unchanged ${stats.skippedUnchanged}.`
  );
}

main().catch((error) => {
  console.error("❌ House disclosure import failed:", error);
  process.exit(1);
});
