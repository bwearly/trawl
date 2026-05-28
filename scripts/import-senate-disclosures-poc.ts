import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeTradeType } from "../lib/domain/pipeline/normalization";

type SenatorRow = {
  id: number;
  fullName: string;
  state: string | null;
  party: string | null;
  bioguideId: string | null;
};

type ReportMetadata = {
  filerName: string | null;
  parsedFullName: string | null;
  filerNameNormalized: string | null;
  nameParsingStrategy: string;
  bioguideId: string | null;
  state: string | null;
  filingDate: string | null;
  reportType: string;
  sourceUrl: string | null;
  rowText: string;
  transactionExtractionPossible: boolean;
};

type MatchedReport = ReportMetadata & {
  politicianId: number;
  politicianName: string;
  politicianState: string | null;
  politicianParty: string | null;
  matchMethod: "bioguideId" | "normalizedNameState" | "normalizedName";
};

type RawTransactionRow = {
  reportUrl: string;
  reportUuid: string | null;
  politicianId: number | null;
  filerName: string;
  filingDate: string | null;
  rowIndex: number;
  columns: Record<string, string>;
  rawRowText: string;
  parserConfidence: "high" | "medium" | "low";
  warnings: string[];
};

type NormalizedCandidateRow = {
  filerName: string;
  politicianId: number | null;
  reportUrl: string;
  reportUuid: string | null;
  filingDate: string | null;
  tradeDate: string | null;
  filingLagDays: number | null;
  owner: string | null;
  ownerType: "self" | "spouse" | "dependent" | "joint" | "unknown";
  ticker: string | null;
  assetName: string;
  assetType: string | null;
  tradeType: "purchase" | "sale" | "exchange";
  amountRange: string | null;
  amountMin: number | null;
  amountMax: number | null;
  comments: string | null;
  rawRowText: string;
  parserConfidence: "high" | "medium" | "low";
  warnings: string[];
  sourceLabel: "senate-efd-ptr";
};

type ParserFailure = {
  reportUrl: string;
  reportUuid: string | null;
  reason: string;
  detail?: string;
};

type ReportAttempt = {
  reportUrl: string;
  reportUuid: string | null;
  politicianId: number | null;
  filerName: string;
  filingDate: string | null;
  source: "cache" | "live" | "skipped";
  cachePath?: string;
  rawRows: RawTransactionRow[];
  normalizedRows: NormalizedCandidateRow[];
  failures: ParserFailure[];
  warnings: string[];
};

type Options = {
  limit: number;
  cacheDir: string;
  outputDir: string;
  json: boolean;
  cacheOnly: boolean;
  delayMs: number;
};

const HOME_URL = "https://efdsearch.senate.gov/search/home/";
const DEFAULT_CACHE_DIR = "tmp/senate-disclosures-cache";
const DEFAULT_OUTPUT_DIR = "tmp/senate-disclosures-poc";
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const DEFAULT_DELAY_MS = 1_500;
const SOURCE_LABEL = "senate-efd-ptr" as const;
const PLACEHOLDER_TICKERS = new Set([
  "",
  "--",
  "—",
  "N/A",
  "NA",
  "NONE",
  "NULL",
]);

function parseOptions(argv: string[]): Options {
  let limit = DEFAULT_LIMIT;
  let cacheDir = DEFAULT_CACHE_DIR;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let json = false;
  let cacheOnly = false;
  let delayMs = DEFAULT_DELAY_MS;

  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--cache-only" || arg === "--replay-cache")
      cacheOnly = true;
    else if (arg.startsWith("--limit="))
      limit = parsePositiveInt(arg, "--limit", 1, MAX_LIMIT);
    else if (arg.startsWith("--cache-dir="))
      cacheDir = parseNonEmptyValue(arg, "--cache-dir");
    else if (arg.startsWith("--output-dir="))
      outputDir = parseNonEmptyValue(arg, "--output-dir");
    else if (arg.startsWith("--delay-ms="))
      delayMs = parsePositiveInt(arg, "--delay-ms", 1_000, 60_000);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, cacheDir, outputDir, json, cacheOnly, delayMs };
}

function parsePositiveInt(arg: string, name: string, min: number, max: number) {
  const value = Number.parseInt(arg.split("=").slice(1).join("="), 10);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function parseNonEmptyValue(arg: string, name: string) {
  const value = arg.split("=").slice(1).join("=").trim();
  if (!value) throw new Error(`${name} requires a non-empty value`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(value: string) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function normalizeDisplayName(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(Senator|Report|Periodic Transaction Report|Filed)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNameTokens(value: string | null) {
  if (!value) return [];
  return decodeHtmlEntities(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,.'’\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .split(" ")
    .filter(Boolean);
}

function reorderLastFirstName(value: string) {
  const [last, ...rest] = value.split(",");
  if (!last || rest.length === 0) return value;
  const first = rest
    .join(",")
    .replace(/\([^)]*\)/g, " ")
    .trim();
  const cleanLast = last.trim();
  return first && cleanLast ? `${first} ${cleanLast}` : value;
}

function removeMiddleInitialTokens(tokens: string[]) {
  if (tokens.length <= 2) return tokens;
  return tokens.filter(
    (token, index) =>
      index === 0 || index === tokens.length - 1 || token.length !== 1,
  );
}

const EXPLICIT_NORMALIZED_NAME_ALIASES = new Map<string, string>([
  ["A MITCHELL MCCONNELL", "MITCH MCCONNELL"],
  ["MITCHELL MCCONNELL", "MITCH MCCONNELL"],
  ["WILLIAM HAGERTY", "BILL HAGERTY"],
  ["BERNARDO MORENO", "BERNIE MORENO"],
  ["MICHAEL ROUNDS", "MIKE ROUNDS"],
  ["M MICHAEL ROUNDS", "MIKE ROUNDS"],
]);

function normalizePersonName(value: string | null) {
  if (!value) return null;
  const stripped = decodeHtmlEntities(value)
    .replace(
      /^\s*(the\s+honorable|hon\.?|senator|sen\.?|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i,
      "",
    )
    .trim();
  const tokens = removeMiddleInitialTokens(
    splitNameTokens(reorderLastFirstName(stripped)),
  );
  if (tokens.length === 0) return null;
  const normalized = tokens.join(" ");
  return EXPLICIT_NORMALIZED_NAME_ALIASES.get(normalized) ?? normalized;
}

function fullNameFromLastFirst(lastFirst: string) {
  const commaIndex = lastFirst.lastIndexOf(",");
  if (commaIndex < 1) return null;
  const last = normalizeDisplayName(lastFirst.slice(0, commaIndex));
  const first = normalizeDisplayName(lastFirst.slice(commaIndex + 1));
  if (!first || !last) return null;
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}

function extractHref(value: string) {
  const href = value.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  if (!href) return null;
  return href.startsWith("http") ? href : new URL(href, HOME_URL).toString();
}

function isoDateFromAnyText(value: string) {
  const mdy = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!mdy) return null;
  const [, mm, dd, yyyy] = mdy;
  return toIsoDate(
    new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))),
  );
}

function extractReportType(cells: string[], rowText: string) {
  if (/Periodic\s+Transaction\s+Report|\bPTR\b/i.test(cells.join(" ")))
    return "Periodic Transaction Report";
  const reportTypeCell = cells.find((cell) => /Report/i.test(stripTags(cell)));
  return reportTypeCell ? stripTags(reportTypeCell) : rowText.slice(0, 80);
}

function extractFilerName(row: unknown, cells: string[], rowText: string) {
  if (row && !Array.isArray(row) && typeof row === "object") {
    const preferred = Object.entries(row as Record<string, unknown>).find(
      ([key, value]) =>
        /filer|senator|name/i.test(key) &&
        !/report|date|url|link/i.test(key) &&
        /[A-Za-z]/.test(stripTags(String(value ?? ""))),
    );
    if (preferred) {
      const text = normalizeDisplayName(stripTags(String(preferred[1] ?? "")));
      return {
        name: text.includes(",") ? (fullNameFromLastFirst(text) ?? text) : text,
        strategy: `structuredField:${preferred[0]}`,
      };
    }
  }

  const beforeSenator = rowText
    .match(/^(.+?)\s*\(\s*Senator\s*\)/i)?.[1]
    ?.trim();
  if (beforeSenator) {
    const lastFirst = fullNameFromLastFirst(beforeSenator);
    if (lastFirst)
      return { name: lastFirst, strategy: "rowTextLastFirstBeforeSenator" };
  }

  for (const [index, cell] of cells.entries()) {
    const text = normalizeDisplayName(stripTags(cell));
    if (!text || /Report|Filed|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) continue;
    const lastFirst = text.includes(",") ? fullNameFromLastFirst(text) : null;
    if (lastFirst)
      return { name: lastFirst, strategy: `cellLastFirst:${index}` };
    if (text.split(/\s+/).length > 1)
      return { name: text, strategy: `cellFullName:${index}` };
  }

  return { name: null, strategy: "notParsed" };
}

function reportFromRow(row: unknown): ReportMetadata | null {
  const cells = Array.isArray(row)
    ? row.map((cell) => String(cell ?? ""))
    : Object.values(row as Record<string, unknown>).map((cell) =>
        String(cell ?? ""),
      );
  const rowText = stripTags(cells.join(" "));
  const sourceUrl =
    cells.map(extractHref).find((url): url is string => Boolean(url)) ?? null;
  const reportType = extractReportType(cells, rowText);
  const parsedFiler = extractFilerName(row, cells, rowText);
  const filerName = parsedFiler.name;
  const state = rowText.match(/\b([A-Z]{2})\b/)?.[1] ?? null;
  const bioguideId = rowText.match(/\b[A-Z]\d{6}\b/)?.[0] ?? null;

  if (!sourceUrl && !filerName && !isoDateFromAnyText(rowText)) return null;

  return {
    filerName,
    parsedFullName: filerName,
    filerNameNormalized: normalizePersonName(filerName),
    nameParsingStrategy: parsedFiler.strategy,
    bioguideId,
    state,
    filingDate: isoDateFromAnyText(rowText),
    reportType,
    sourceUrl,
    rowText,
    transactionExtractionPossible: sourceUrl
      ? /\/search\/view\/ptr\//i.test(sourceUrl)
      : false,
  };
}

async function loadCurrentSenators(): Promise<{
  senators: SenatorRow[];
  warning: string | null;
}> {
  try {
    const [{ and, eq }, { db }, { politicians }] = await Promise.all([
      import("drizzle-orm"),
      import("../lib/db"),
      import("../lib/db/schema"),
    ]);

    const senators = await db
      .select({
        id: politicians.id,
        fullName: politicians.fullName,
        state: politicians.state,
        party: politicians.party,
        bioguideId: politicians.bioguideId,
      })
      .from(politicians)
      .where(
        and(eq(politicians.chamber, "senate"), eq(politicians.isActive, true)),
      )
      .orderBy(politicians.state, politicians.fullName);

    return { senators, warning: null };
  } catch (error) {
    return {
      senators: [],
      warning: `Could not load active Senate roster from the database: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

type CachedReportDataFile = {
  fileName: string;
  path: string;
  mtimeMs: number;
  start: number;
};

async function listCachedReportDataFiles(
  cacheDir: string,
): Promise<CachedReportDataFile[]> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return [];
  }

  const files: CachedReportDataFile[] = [];
  for (const fileName of entries) {
    const match = fileName.match(/-report-data-start-(\d+)-[a-f0-9]+\.txt$/i);
    if (!match) continue;
    const path = join(cacheDir, fileName);
    const metadata = await stat(path);
    files.push({
      fileName,
      path,
      mtimeMs: metadata.mtimeMs,
      start: Number.parseInt(match[1], 10),
    });
  }
  return files.sort(
    (left, right) =>
      right.mtimeMs - left.mtimeMs ||
      left.start - right.start ||
      left.fileName.localeCompare(right.fileName),
  );
}

function latestCachedReportDataRun(files: CachedReportDataFile[]) {
  if (files.length === 0) return [];
  const newest = files[0].mtimeMs;
  return files
    .filter((file) => newest - file.mtimeMs <= 10 * 60 * 1000)
    .sort(
      (left, right) =>
        left.start - right.start || left.fileName.localeCompare(right.fileName),
    );
}

async function loadReportsFromDiscoveryCache(cacheDir: string, limit: number) {
  const cachedFiles = latestCachedReportDataRun(
    await listCachedReportDataFiles(cacheDir),
  );
  const reports: ReportMetadata[] = [];
  for (const file of cachedFiles) {
    const responseText = await readFile(file.path, "utf8");
    const parsed = JSON.parse(responseText) as { data?: unknown[] };
    for (const row of parsed.data ?? []) {
      const report = reportFromRow(row);
      if (report) reports.push(report);
      if (reports.length >= limit * 5) break;
    }
    if (reports.length >= limit * 5) break;
  }
  return {
    reports,
    replayedReportDataFiles: cachedFiles.map((file) => file.fileName),
  };
}

function matchReports(reports: ReportMetadata[], senators: SenatorRow[]) {
  const byBioguide = new Map(
    senators
      .filter((senator) => senator.bioguideId)
      .map((senator) => [senator.bioguideId, senator]),
  );
  const byName = new Map<string, SenatorRow[]>();
  for (const senator of senators) {
    const key = normalizePersonName(senator.fullName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), senator]);
  }

  const matched: MatchedReport[] = [];
  for (const report of reports) {
    const byBioguideMatch = report.bioguideId
      ? byBioguide.get(report.bioguideId)
      : null;
    if (byBioguideMatch) {
      matched.push(toMatchedReport(report, byBioguideMatch, "bioguideId"));
      continue;
    }

    const candidates = report.filerNameNormalized
      ? (byName.get(report.filerNameNormalized) ?? [])
      : [];
    if (candidates.length === 1) {
      matched.push(toMatchedReport(report, candidates[0], "normalizedName"));
      continue;
    }

    const stateMatched = report.state
      ? candidates.filter((candidate) => candidate.state === report.state)
      : [];
    if (stateMatched.length === 1)
      matched.push(
        toMatchedReport(report, stateMatched[0], "normalizedNameState"),
      );
  }
  return matched.filter(
    (report) => report.transactionExtractionPossible && report.sourceUrl,
  );
}

function toMatchedReport(
  report: ReportMetadata,
  senator: SenatorRow,
  matchMethod: MatchedReport["matchMethod"],
): MatchedReport {
  return {
    ...report,
    politicianId: senator.id,
    politicianName: senator.fullName,
    politicianState: senator.state,
    politicianParty: senator.party,
    matchMethod,
  };
}

function reportUuidFromUrl(url: string) {
  return url.match(/\/search\/view\/ptr\/([^/?#]+)\/?/i)?.[1] ?? null;
}

function reportCacheBaseName(url: string) {
  const uuid = reportUuidFromUrl(url);
  if (uuid) return `ptr-report-${uuid}.html`;
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `ptr-report-${digest}.html`;
}

async function readCachedReportPage(cacheDir: string, url: string) {
  const preferred = join(cacheDir, reportCacheBaseName(url));
  try {
    return { html: await readFile(preferred, "utf8"), path: preferred };
  } catch {
    // Continue to older timestamped cache names written by previous POC attempts or manual saves.
  }

  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return null;
  }

  const uuid = reportUuidFromUrl(url);
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const candidates = entries.filter((entry) =>
    uuid
      ? entry.includes(uuid) && /\.(html?|txt)$/i.test(entry)
      : entry.includes(digest) && /\.(html?|txt)$/i.test(entry),
  );
  if (candidates.length === 0) return null;
  const withStats = await Promise.all(
    candidates.map(async (entry) => ({
      entry,
      metadata: await stat(join(cacheDir, entry)),
    })),
  );
  withStats.sort(
    (left, right) =>
      right.metadata.mtimeMs - left.metadata.mtimeMs ||
      left.entry.localeCompare(right.entry),
  );
  const path = join(cacheDir, withStats[0].entry);
  return { html: await readFile(path, "utf8"), path };
}

class SenateEfdHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
  ) {
    super(`Senate eFD request failed: ${status} ${statusText} for ${url}`);
  }
}

async function fetchReportPage(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Trawl Senate disclosure Phase 1 POC/0.1 (small sample; research-only)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: HOME_URL,
    },
    redirect: "follow",
  });
  const body = await response.text();
  if (!response.ok)
    throw new SenateEfdHttpError(response.status, response.statusText, url);
  return body;
}

async function loadReportPage(options: Options, url: string) {
  const cached = await readCachedReportPage(options.cacheDir, url);
  if (cached)
    return {
      html: cached.html,
      source: "cache" as const,
      cachePath: cached.path,
    };

  if (options.cacheOnly || process.env.SENATE_EFD_ACKNOWLEDGED !== "true")
    return null;

  await sleep(options.delayMs);
  const html = await fetchReportPage(url);
  await mkdir(options.cacheDir, { recursive: true });
  const cachePath = join(options.cacheDir, reportCacheBaseName(url));
  await writeFile(cachePath, html, "utf8");
  return { html, source: "live" as const, cachePath };
}

function parseDate(raw: string | null | undefined) {
  const cleaned = (raw ?? "").trim();
  if (!cleaned) return null;
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy)
    return new Date(
      Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2])),
    );
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date | null) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dateDiffDays(left: string | null, right: string | null) {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate || !rightDate) return null;
  return Math.floor((leftDate.getTime() - rightDate.getTime()) / 86_400_000);
}

function normalizeTicker(raw: string | null | undefined) {
  const value = (raw ?? "").trim().toUpperCase();
  return PLACEHOLDER_TICKERS.has(value) ? null : value;
}

function normalizeOwner(
  raw: string | null | undefined,
): NormalizedCandidateRow["ownerType"] {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("joint")) return "joint";
  if (value.includes("spouse") || value === "sp") return "spouse";
  if (value.includes("dependent") || value.includes("child") || value === "dc")
    return "dependent";
  if (value.includes("self") || value === "jt" || value === "")
    return value === "jt" ? "joint" : "self";
  return "unknown";
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADER_ALIASES: Record<string, string[]> = {
  tradeDate: ["transaction date", "trade date", "date"],
  owner: ["owner"],
  ticker: ["ticker", "symbol"],
  assetName: ["asset name", "asset", "description", "issuer"],
  assetType: ["asset type", "type of asset"],
  tradeType: ["type", "transaction type"],
  amount: ["amount", "amount range", "value"],
  comments: ["comment", "comments", "description comments"],
};

function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const exact = normalized.indexOf(alias);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const fuzzy = normalized.findIndex(
      (header) => header.includes(alias) || alias.includes(header),
    );
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

function parseAmountRange(raw: string | null | undefined) {
  const label = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { amountRange: null, amountMin: null, amountMax: null };
  const amounts = [...label.matchAll(/\$?([0-9][0-9,]*)/g)].map((match) =>
    Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10),
  );
  const valid = amounts.filter(Number.isFinite);
  return {
    amountRange: label,
    amountMin: valid[0] ?? null,
    amountMax: valid[1] ?? valid[0] ?? null,
  };
}

function confidenceFor(warnings: string[]) {
  if (warnings.length === 0) return "high" as const;
  if (warnings.length <= 2) return "medium" as const;
  return "low" as const;
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => match[1] ?? "",
  );
}

function rowCells(rowHtml: string) {
  return [...rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(
    (match) => textFromHtml(match[1] ?? ""),
  );
}

function extractReportLevelFields(html: string, fallback: MatchedReport) {
  const h2Match = html.match(
    /<h2[^>]*class=["'][^"']*filedReport[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
  );
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const filerText = textFromHtml(
    h2Match?.[1] ?? h1Match?.[1] ?? titleMatch?.[1] ?? "",
  );
  const filingText = textFromHtml(
    html.match(
      /<strong[^>]*class=["'][^"']*noWrap[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i,
    )?.[1] ?? "",
  );
  const filingDate =
    isoDateFromAnyText(filingText) ??
    isoDateFromAnyText(textFromHtml(html)) ??
    fallback.filingDate;
  return {
    filerName:
      normalizeDisplayName(filerText) ||
      fallback.politicianName ||
      fallback.filerName ||
      "Unknown",
    filingDate,
  };
}

function parseTransactionsFromHtml(
  html: string,
  report: MatchedReport,
): {
  rawRows: RawTransactionRow[];
  normalizedRows: NormalizedCandidateRow[];
  failures: ParserFailure[];
} {
  const reportUuid = report.sourceUrl
    ? reportUuidFromUrl(report.sourceUrl)
    : null;
  const reportUrl = report.sourceUrl ?? "unknown";
  const reportFields = extractReportLevelFields(html, report);
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  const rawRows: RawTransactionRow[] = [];
  const normalizedRows: NormalizedCandidateRow[] = [];
  const failures: ParserFailure[] = [];

  let parsedAnyTable = false;
  for (const table of tables) {
    const rows = tableRows(table);
    if (rows.length < 2) continue;
    const headers = rowCells(rows[0]);
    const headerMap = {
      tradeDate: findHeaderIndex(headers, HEADER_ALIASES.tradeDate),
      owner: findHeaderIndex(headers, HEADER_ALIASES.owner),
      ticker: findHeaderIndex(headers, HEADER_ALIASES.ticker),
      assetName: findHeaderIndex(headers, HEADER_ALIASES.assetName),
      assetType: findHeaderIndex(headers, HEADER_ALIASES.assetType),
      tradeType: findHeaderIndex(headers, HEADER_ALIASES.tradeType),
      amount: findHeaderIndex(headers, HEADER_ALIASES.amount),
      comments: findHeaderIndex(headers, HEADER_ALIASES.comments),
    };

    if (
      headerMap.tradeDate < 0 ||
      headerMap.assetName < 0 ||
      headerMap.tradeType < 0 ||
      headerMap.amount < 0
    )
      continue;
    parsedAnyTable = true;

    for (const rowHtml of rows.slice(1)) {
      const cells = rowCells(rowHtml);
      if (cells.length === 0 || cells.every((cell) => !cell)) continue;
      const get = (index: number) =>
        index >= 0 ? (cells[index]?.trim() ?? "") : "";
      const warnings: string[] = [];
      const tradeDateRaw = get(headerMap.tradeDate);
      const tradeDate = toIsoDate(parseDate(tradeDateRaw));
      const owner = get(headerMap.owner) || null;
      const ticker = normalizeTicker(get(headerMap.ticker));
      const assetName = get(headerMap.assetName);
      const assetType = get(headerMap.assetType) || null;
      const tradeTypeRaw = get(headerMap.tradeType);
      const comments = get(headerMap.comments) || null;
      const amount = parseAmountRange(get(headerMap.amount));

      if (!tradeDate) warnings.push("missing_trade_date");
      if (!ticker) warnings.push("missing_ticker");
      if (!amount.amountRange) warnings.push("missing_amount");
      if (!assetName) warnings.push("missing_asset_name");
      if (!tradeTypeRaw) warnings.push("missing_trade_type");

      const parserConfidence = confidenceFor(warnings);
      const columns = Object.fromEntries(
        headers.map((header, index) => [
          header || `column_${index}`,
          cells[index] ?? "",
        ]),
      );
      const rawRowText = cells.join(" | ");
      const rowIndex = rawRows.length;
      rawRows.push({
        reportUrl,
        reportUuid,
        politicianId: report.politicianId,
        filerName: reportFields.filerName,
        filingDate: reportFields.filingDate,
        rowIndex,
        columns,
        rawRowText,
        parserConfidence,
        warnings,
      });

      if (!assetName || !tradeTypeRaw) continue;
      normalizedRows.push({
        filerName: reportFields.filerName,
        politicianId: report.politicianId,
        reportUrl,
        reportUuid,
        filingDate: reportFields.filingDate,
        tradeDate,
        filingLagDays: dateDiffDays(reportFields.filingDate, tradeDate),
        owner,
        ownerType: normalizeOwner(owner),
        ticker,
        assetName,
        assetType,
        tradeType: normalizeTradeType(tradeTypeRaw),
        amountRange: amount.amountRange,
        amountMin: amount.amountMin,
        amountMax: amount.amountMax,
        comments,
        rawRowText,
        parserConfidence,
        warnings,
        sourceLabel: SOURCE_LABEL,
      });
    }
  }

  if (!parsedAnyTable)
    failures.push({
      reportUrl,
      reportUuid,
      reason: "transaction_table_not_found",
      detail:
        "No table contained transaction date, asset name, type, and amount headers.",
    });
  else if (rawRows.length === 0)
    failures.push({
      reportUrl,
      reportUuid,
      reason: "transaction_rows_not_found",
    });
  return { rawRows, normalizedRows, failures };
}

async function attemptReport(
  options: Options,
  report: MatchedReport,
): Promise<ReportAttempt> {
  const reportUrl = report.sourceUrl ?? "unknown";
  const reportUuid = reportUuidFromUrl(reportUrl);
  const base = {
    reportUrl,
    reportUuid,
    politicianId: report.politicianId,
    filerName: report.politicianName,
    filingDate: report.filingDate,
  };

  const loaded = await loadReportPage(options, reportUrl);
  if (!loaded) {
    return {
      ...base,
      source: "skipped",
      rawRows: [],
      normalizedRows: [],
      failures: [
        {
          reportUrl,
          reportUuid,
          reason:
            process.env.SENATE_EFD_ACKNOWLEDGED === "true"
              ? "report_page_not_cached_cache_only"
              : "senate_efd_acknowledgement_required",
          detail:
            "No cached report page is available. Set SENATE_EFD_ACKNOWLEDGED=true only after accepting the official eFD acknowledgement, or place cached report HTML in tmp/senate-disclosures-cache/.",
        },
      ],
      warnings: [],
    };
  }

  const parsed = parseTransactionsFromHtml(loaded.html, report);
  return {
    ...base,
    source: loaded.source,
    cachePath: loaded.cachePath,
    rawRows: parsed.rawRows,
    normalizedRows: parsed.normalizedRows,
    failures: parsed.failures,
    warnings: [],
  };
}

function summarize(
  attempts: ReportAttempt[],
  parserFailures: ParserFailure[],
  replayedReportDataFiles: string[],
  currentSenatorsLoaded: number,
  matchedReportsAvailable: number,
  options: Options,
  rosterWarning: string | null,
) {
  const rawRows = attempts.flatMap((attempt) => attempt.rawRows);
  const normalizedRows = attempts.flatMap((attempt) => attempt.normalizedRows);
  return {
    mode: "phase-1-poc",
    dryRun: true,
    disclosureWritesEnabled: false,
    sourceLabel: SOURCE_LABEL,
    generatedAt: new Date().toISOString(),
    currentSenatorsLoaded,
    matchedReportsAvailable,
    rosterWarning,
    diagnostics: {
      reportsAttempted: attempts.length,
      reportPagesFetchedFromLive: attempts.filter(
        (attempt) => attempt.source === "live",
      ).length,
      reportPagesReadFromCache: attempts.filter(
        (attempt) => attempt.source === "cache",
      ).length,
      reportsParsed: attempts.filter(
        (attempt) => attempt.normalizedRows.length > 0,
      ).length,
      transactionRowsExtracted: rawRows.length,
      rowsNormalized: normalizedRows.length,
      skippedReportCount: attempts.filter(
        (attempt) => attempt.source === "skipped",
      ).length,
      parserFailures: parserFailures.length,
      missingTickerCount: normalizedRows.filter((row) => !row.ticker).length,
      missingAmountCount: normalizedRows.filter((row) => !row.amountRange)
        .length,
      missingTradeDateCount: normalizedRows.filter((row) => !row.tradeDate)
        .length,
      sampleNormalizedRows: normalizedRows.slice(0, 5),
    },
    cache: {
      directory: options.cacheDir,
      replayedReportDataFiles,
      outputDirectory: options.outputDir,
    },
    attempts,
    rawRows,
    normalizedRows,
    parserFailures,
    nextSteps:
      attempts.length === 0 ||
      attempts.every((attempt) => attempt.source === "skipped")
        ? [
            "Run npm run senate:discover -- --replay-cache --json to confirm metadata cache availability.",
            "Cache a tiny acknowledged sample of PTR report pages or rerun with SENATE_EFD_ACKNOWLEDGED=true after reviewing the official eFD acknowledgement.",
            "Do not bypass Senate eFD access controls; if live eFD returns 403, use already cached pages or retry manually later from an allowed network.",
          ]
        : [
            "Review rawRows and normalizedRows fixtures before any future normalization/import phase.",
            "Keep Phase 1 dry-run only; disclosure insertion belongs to a later approved phase.",
          ],
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const { senators, warning: rosterWarning } = await loadCurrentSenators();
  const { reports, replayedReportDataFiles } =
    await loadReportsFromDiscoveryCache(options.cacheDir, options.limit);
  const matchedReports = matchReports(reports, senators);
  const sample = matchedReports.slice(0, options.limit);
  const attempts: ReportAttempt[] = [];
  const parserFailures: ParserFailure[] = [];

  for (const report of sample) {
    try {
      const attempt = await attemptReport(options, report);
      attempts.push(attempt);
      parserFailures.push(...attempt.failures);
    } catch (error) {
      const reportUrl = report.sourceUrl ?? "unknown";
      const reportUuid = reportUuidFromUrl(reportUrl);
      const failure: ParserFailure = {
        reportUrl,
        reportUuid,
        reason: "report_fetch_or_parse_failed",
        detail: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof SenateEfdHttpError && error.status === 403) {
        failure.reason = "senate_efd_403";
        failure.detail = `Senate eFD returned 403 Forbidden for ${error.url}. No bypass was attempted. Use cached report pages if available, or retry manually later from an allowed network after reviewing the official eFD acknowledgement.`;
        process.exitCode = 2;
      }
      parserFailures.push(failure);
      attempts.push({
        reportUrl,
        reportUuid,
        politicianId: report.politicianId,
        filerName: report.politicianName,
        filingDate: report.filingDate,
        source: "skipped",
        rawRows: [],
        normalizedRows: [],
        failures: [failure],
        warnings: [],
      });
    }
  }

  if (sample.length === 0) {
    parserFailures.push({
      reportUrl: "cache-replay",
      reportUuid: null,
      reason: "no_matched_ptr_reports_from_discovery_cache",
      detail: `No matched PTR report URLs were found in ${options.cacheDir}.`,
    });
  }

  const fixture = summarize(
    attempts,
    parserFailures,
    replayedReportDataFiles,
    senators.length,
    matchedReports.length,
    options,
    rosterWarning,
  );

  if (options.json) {
    console.log(JSON.stringify(fixture, null, 2));
    return;
  }

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(
    join(options.outputDir, "senate-poc-fixture.json"),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(options.outputDir, "senate-poc-raw-rows.json"),
    `${JSON.stringify(fixture.rawRows, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(options.outputDir, "senate-poc-normalized-candidates.json"),
    `${JSON.stringify(fixture.normalizedRows, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Senate Phase 1 POC complete. reports_attempted=${fixture.diagnostics.reportsAttempted} rows_normalized=${fixture.diagnostics.rowsNormalized} parser_failures=${fixture.diagnostics.parserFailures}`,
  );
  console.log(
    `Wrote fixtures to ${options.outputDir}. No disclosure rows were inserted.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
