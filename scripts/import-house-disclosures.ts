import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNull } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveHouseTicker, type TickerResolutionSource } from "./lib/house-asset-resolution";
import { db } from "../lib/db";
import { disclosures, politicians } from "../lib/db/schema";

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

type NormalizedDisclosure = {
  politicianName: string;
  party: string | null;
  state: string | null;
  chamber: "house";
  ticker: string | null;
  assetName: string;
  assetType: string;
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
};

type ImportStats = {
  inserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};

type PtrRowSkipReason =
  | "missing_trade_date"
  | "missing_trade_type"
  | "missing_asset_name"
  | "missing_politician_name"
  | "ambiguous_line";

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
      const value = raw.trim();
      if (value.length > 0) return value;
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

function normalizeTradeType(raw: string | null): NormalizedDisclosure["tradeType"] {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "P" || value.includes("PURCHASE") || value.includes("BUY")) {
    return "purchase";
  }
  if (value === "S" || value.includes("SALE") || value.includes("SELL")) {
    return "sale";
  }
  return "exchange";
}

function normalizeOwnerType(raw: string | null): NormalizedDisclosure["ownerType"] {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("spouse")) return "spouse";
  if (value.includes("child") || value.includes("dependent")) return "dependent";
  if (value.includes("joint")) return "joint";
  if (value.includes("self") || value === "jt") return "self";
  return "unknown";
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
      disableWorker: true,
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
  return "unknown";
}

function parseLeadingOwnerToken(line: string): { ownerType: NormalizedDisclosure["ownerType"]; ownerTokenLength: number } {
  const match = line.match(/^\s*(SP|SPOUSE|JT|JOINT|DC|DEPENDENT|CHILD|SELF)\b/i);
  if (!match) return { ownerType: "unknown", ownerTokenLength: 0 };
  return {
    ownerType: parseOwnerTypeFromText(match[1]),
    ownerTokenLength: match[0].length,
  };
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
  return raw
    .replace(/^\s*(SP|SPOUSE|JT|JOINT|DC|DEPENDENT|CHILD|SELF)\b[:\-\s]*/i, "")
    .replace(/\(partial\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\W+|\W+$/g, "")
    .trim();
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

function parsePtrTransactionsFromPdfText(params: {
  text: string;
  sourceRow: HouseRow;
  sourceUrl: string;
}): {
  normalized: NormalizedDisclosure[];
  transactionLikeLineCount: number;
  skipReasons: Map<PtrRowSkipReason, number>;
  assetFailureReasons: Map<PtrAssetParseFailureReason, number>;
  suspiciousAssetSamples: PtrSuspiciousAssetSample[];
  beforeAfterSamples: PtrBeforeAfterSample[];
} {
  const { text, sourceRow, sourceUrl } = params;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  const skipReasons = new Map<PtrRowSkipReason, number>();
  const assetFailureReasons = new Map<PtrAssetParseFailureReason, number>();
  const normalized: NormalizedDisclosure[] = [];
  const suspiciousAssetSamples: PtrSuspiciousAssetSample[] = [];
  const beforeAfterSamples: PtrBeforeAfterSample[] = [];
  const politicianName = buildPoliticianNameFromHouseRow(sourceRow);
  const filingDate = parseDate(getValue(sourceRow, ["filing date", "filingdate", "filed"]));
  const party = normalizeParty(getValue(sourceRow, ["party"]));
  const state = getValue(sourceRow, ["state"]);

  let transactionLikeLineCount = 0;

  for (const line of lines) {
    const hasDate = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line);
    const transactionTypeMatch = line.match(/\b(Purchase|Sale|Exchange)\b/i);
    const hasTradeType = Boolean(transactionTypeMatch);
    const hasAmount = Boolean(extractLikelyAmountText(line));
    if (!(hasDate && hasTradeType && hasAmount)) {
      continue;
    }

    transactionLikeLineCount += 1;

    if (!politicianName) {
      skipReasons.set("missing_politician_name", (skipReasons.get("missing_politician_name") ?? 0) + 1);
      continue;
    }

    const dates = [...line.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)].map((match) => match[0]);
    const tradeDate = parseDate(dates[0] ?? null);
    if (!tradeDate) {
      skipReasons.set("missing_trade_date", (skipReasons.get("missing_trade_date") ?? 0) + 1);
      continue;
    }

    const tradeTypeMatch = line.match(/\b(Purchase|Sale|Exchange)\b/i);
    if (!tradeTypeMatch) {
      skipReasons.set("missing_trade_type", (skipReasons.get("missing_trade_type") ?? 0) + 1);
      continue;
    }

    const amountText = normalizeAmountInput(extractLikelyAmountText(line));
    const amount = normalizeAmountRange(amountText);

    const tickerMatch = line.match(/\(([A-Z.\-]{1,8})\)/);
    const rawTicker = tickerMatch?.[1] ?? null;

    const legacyAssetName = buildLegacyPtrAssetCandidate(line);
    const transactionTypeIndex = tradeTypeMatch.index ?? -1;
    const beforeTx = transactionTypeIndex >= 0 ? line.slice(0, transactionTypeIndex) : "";
    const afterTx =
      transactionTypeIndex >= 0
        ? line.slice(transactionTypeIndex + tradeTypeMatch[0].length).trim()
        : "";
    const assetName = cleanAssetName(beforeTx);
    if (!assetName) {
      assetFailureReasons.set(
        "missing_asset_span",
        (assetFailureReasons.get("missing_asset_span") ?? 0) + 1
      );
      skipReasons.set("missing_asset_name", (skipReasons.get("missing_asset_name") ?? 0) + 1);
      console.log(
        `🧪 PTR asset extraction failed (missing span): line="${line}" extractedAsset="${assetName}" afterTx="${afterTx}"`
      );
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
      console.log(
        `🧪 PTR asset extraction failed (amount-like): line="${line}" extractedAsset="${assetName}" afterTx="${afterTx}"`
      );
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
      console.log(
        `🧪 PTR asset extraction failed (too short): line="${line}" extractedAsset="${assetName}" afterTx="${afterTx}"`
      );
      continue;
    }

    if (beforeAfterSamples.length < 8 && legacyAssetName !== assetName) {
      beforeAfterSamples.push({ line, before: legacyAssetName, after: assetName });
    }

    if (assetName.split(" ").length > 40) {
      skipReasons.set("ambiguous_line", (skipReasons.get("ambiguous_line") ?? 0) + 1);
      continue;
    }

    const filingLagDays = filingDate
      ? Math.floor((filingDate.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const resolvedTicker = resolveHouseTicker({
      rawTicker,
      rawAssetName: assetName,
    });

    normalized.push({
      politicianName,
      party,
      state,
      chamber: "house",
      ticker: resolvedTicker.ticker,
      assetName,
      assetType: inferAssetType(assetName),
      tradeType: normalizeTradeType(tradeTypeMatch[1] ?? null),
      ownerType: parseLeadingOwnerToken(line).ownerType,
      amountRangeLabel: amount.label,
      amountMin: amount.min,
      amountMax: amount.max,
      tradeDate,
      filingDate,
      filingLagDays,
      sourceUrl,
      sourceLabel: HOUSE_SOURCE_LABEL,
      normalizedAssetName: resolvedTicker.normalization.canonicalAssetName,
      tickerResolutionSource: resolvedTicker.source,
    });
  }

  return {
    normalized,
    transactionLikeLineCount,
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
  const filingLagDays = filingDate
    ? Math.floor((filingDate.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const amount = normalizeAmountRange(
    getValue(row, ["amount", "amount range", "amount range label", "value"])
  );

  const resolvedTicker = resolveHouseTicker({
    rawTicker: getValue(row, ["ticker", "symbol"]),
    rawAssetName: assetName,
  });

  return {
    politicianName,
    party: normalizeParty(getValue(row, ["party"])),
    state: getValue(row, ["state", "district state", "st"]),
    chamber: "house",
    ticker: resolvedTicker.ticker,
    assetName,
    assetType: inferAssetType(assetName),
    tradeType: normalizeTradeType(getValue(row, ["type", "transaction type", "tx type"])),
    ownerType: normalizeOwnerType(getValue(row, ["owner", "owner type"])),
    amountRangeLabel: amount.label,
    amountMin: amount.min,
    amountMax: amount.max,
    tradeDate,
    filingDate,
    filingLagDays,
    sourceUrl: buildSourceUrl(year, row),
    sourceLabel: HOUSE_SOURCE_LABEL,
    normalizedAssetName: resolvedTicker.normalization.canonicalAssetName,
    tickerResolutionSource: resolvedTicker.source,
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
  console.log(`📥 Downloading ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
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
    .select({ id: politicians.id })
    .from(politicians)
    .where(
      and(
        eq(politicians.fullName, normalized.politicianName),
        eq(politicians.chamber, normalized.chamber)
      )
    )
    .limit(1);

  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(politicians)
    .values({
      fullName: normalized.politicianName,
      chamber: normalized.chamber,
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
  const existing = await db
    .select({ id: disclosures.id })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.politicianId, politicianId),
        eq(disclosures.assetName, normalized.assetName),
        eq(disclosures.tradeType, normalized.tradeType),
        eq(disclosures.tradeDate, normalized.tradeDate),
        normalized.filingDate ? eq(disclosures.filingDate, normalized.filingDate) : isNull(disclosures.filingDate),
        normalized.ticker ? eq(disclosures.ticker, normalized.ticker) : isNull(disclosures.ticker)
      )
    )
    .limit(1);

  return Boolean(existing[0]);
}

async function importNormalizedDisclosures(rows: NormalizedDisclosure[]): Promise<ImportStats> {
  const stats: ImportStats = { inserted: 0, skippedDuplicate: 0, skippedInvalid: 0 };

  for (const row of rows) {
    const politicianId = await getOrCreatePoliticianId(row);
    const duplicate = await isDuplicateDisclosure(politicianId, row);

    if (duplicate) {
      stats.skippedDuplicate += 1;
      continue;
    }

    await db.insert(disclosures).values({
      politicianId,
      ticker: row.ticker,
      assetName: row.assetName,
      assetType: row.assetType,
      tradeType: row.tradeType,
      ownerType: row.ownerType,
      amountRangeLabel: row.amountRangeLabel,
      amountMin: row.amountMin,
      amountMax: row.amountMax,
      tradeDate: row.tradeDate,
      filingDate: row.filingDate,
      filingLagDays: row.filingLagDays,
      sourceUrl: row.sourceUrl,
      sourceLabel: row.sourceLabel,
      updatedAt: new Date(),
    });

    stats.inserted += 1;
  }

  return stats;
}

async function main() {
  const years = parseYearsArg();

  if (years.length === 0) {
    throw new Error("No valid years provided. Use --years=2026 or similar.");
  }

  console.log(`🏛️ House import started for year(s): ${years.join(", ")}`);

  const normalizedRows: NormalizedDisclosure[] = [];
  const failureReasonCounts = new Map<NormalizationFailureReason, number>();
  const tickerResolutionCounts = new Map<TickerResolutionSource, number>();
  const unresolvedAssetCounts = new Map<string, number>();
  let rejectedRows = 0;

  for (const year of years) {
    const fetchResult = await fetchYearRows(year);
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
      ptrPdfProcessed += 1;

      const guessedUrls = buildDocumentUrlGuesses(year, docId);
      const pdfFetch = await fetchPdfFromGuesses(guessedUrls);

      if (!pdfFetch.buffer || !pdfFetch.finalUrl) {
        console.log(`   📄 Candidate[${index + 1}] DocID=${docId} fetch result: PDF unavailable`);
        continue;
      }

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
      ptrPdfExtracted += 1;

      const parsed = parsePtrTransactionsFromPdfText({
        text: extractedText,
        sourceRow: row,
        sourceUrl: pdfFetch.finalUrl,
      });

      ptrTransactionLikeLines += parsed.transactionLikeLineCount;
      ptrNormalizedRows += parsed.normalized.length;

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

      console.log(
        `      transaction-like lines=${parsed.transactionLikeLineCount}, normalized disclosures=${parsed.normalized.length}`
      );
    }

    console.log(
      `🧪 ${year}: PTR PDFs processed=${ptrPdfProcessed}, extraction succeeded=${ptrPdfExtracted}, transaction-like lines=${ptrTransactionLikeLines}, normalized disclosures=${ptrNormalizedRows}`
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
        const reasons = classifyNormalizationFailure(sourceRow);
        for (const reason of reasons) {
          failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
        }
        continue;
      }
      normalizedRows.push(normalized);
    }
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

  console.log(
    `✅ Import done. Inserted ${stats.inserted}, skipped duplicates ${stats.skippedDuplicate}.`
  );
}

main().catch((error) => {
  console.error("❌ House disclosure import failed:", error);
  process.exit(1);
});
