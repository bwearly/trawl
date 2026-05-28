import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { politicians } from "../lib/db/schema";

type SenatorRow = {
  id: number;
  fullName: string;
  state: string | null;
  party: string | null;
  bioguideId: string | null;
  dataSource: string | null;
  createdAt: Date;
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
  matchMethod: "bioguideId" | "normalizedNameState" | "normalizedName";
  matchingStrategy: string;
};

type CloseMatchCandidate = {
  politicianId: number;
  politicianName: string;
  state: string | null;
  party: string | null;
  normalizedName: string | null;
  score: number;
};

type UnmatchedReport = ReportMetadata & {
  reason: string;
  matchingStrategy: string;
  closeMatchCandidates: CloseMatchCandidate[];
};

type RosterDiagnosticSenatorRow = Pick<SenatorRow, "id" | "fullName" | "state" | "party" | "bioguideId" | "dataSource" | "createdAt">;

type RosterDiagnostics = {
  countByParty: Record<string, number>;
  countByState: Record<string, number>;
  duplicateBioguideIds: Array<{ bioguideId: string; count: number; senators: Array<Pick<SenatorRow, "id" | "fullName" | "state" | "party">> }>;
  duplicateNormalizedNameStateRows: Array<{ normalizedName: string; state: string | null; count: number; senators: Array<Pick<SenatorRow, "id" | "fullName" | "state" | "party" | "bioguideId">> }>;
  statesWithMoreThanTwoActiveSenators: Array<{ state: string; count: number; senators: RosterDiagnosticSenatorRow[] }>;
};

type DiscoveryDiagnostics = {
  mode: "roster-only" | "blocked" | "discovered" | "cache-replay";
  dryRun: true;
  source: string;
  generatedAt: string;
  currentSenatorsLoaded: number;
  rosterDiagnostics: RosterDiagnostics;
  metadataReportsDiscovered: number;
  matchedToRoster: number;
  unmatched: number;
  reportTypesFound: Record<string, number>;
  dateRangeDiscovered: { start: string | null; end: string | null };
  transactionExtractionPossible: {
    possibleFromDiscoveredReportUrls: boolean;
    possibleCount: number;
    notPossibleCount: number;
    note: string;
  };
  cache: {
    enabled: true;
    directory: string;
    usedCachedResponses: boolean;
    wroteResponses: number;
    noNetworkRequests: boolean;
    replayedReportDataFiles: string[];
  };
  rateLimit: {
    delayMs: number;
    pageSize: number;
    maxReports: number;
  };
  sampleMatchedReports: MatchedReport[];
  sampleUnmatchedReports: UnmatchedReport[];
  skippedOrFailureReasons: string[];
  nextSteps: string[];
};

type Options = {
  limit: number;
  days: number;
  cacheDir: string;
  json: boolean;
  rosterOnly: boolean;
  replayCache: boolean;
  useCache: boolean;
  delayMs: number;
  pageSize: number;
};

const HOME_URL = "https://efdsearch.senate.gov/search/home/";
const REPORT_DATA_URL = "https://efdsearch.senate.gov/search/report/data/";
const SOURCE_LABEL = "official Senate eFD public search";
const DEFAULT_CACHE_DIR = "tmp/senate-disclosures-cache";
const DEFAULT_LIMIT = 50;
const DEFAULT_DAYS = 90;
const DEFAULT_DELAY_MS = 1_500;
const MAX_PAGE_SIZE = 25;
const PTR_REPORT_TYPE_ID = "11";
const SENATOR_FILER_TYPE_ID = "1";

function parseOptions(argv: string[]): Options {
  let limit = DEFAULT_LIMIT;
  let days = DEFAULT_DAYS;
  let cacheDir = DEFAULT_CACHE_DIR;
  let json = false;
  let rosterOnly = false;
  let useCache = true;
  let replayCache = false;
  let delayMs = DEFAULT_DELAY_MS;
  let pageSize = MAX_PAGE_SIZE;

  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--roster-only") rosterOnly = true;
    else if (arg === "--replay-cache") replayCache = true;
    else if (arg === "--no-cache") useCache = false;
    else if (arg.startsWith("--limit=")) {
      limit = parsePositiveInt(arg, "--limit", 1, 500);
    } else if (arg.startsWith("--days=")) {
      days = parsePositiveInt(arg, "--days", 1, 3650);
    } else if (arg.startsWith("--cache-dir=")) {
      const value = arg.split("=").slice(1).join("=").trim();
      if (!value) throw new Error("--cache-dir requires a non-empty value");
      cacheDir = value;
    } else if (arg.startsWith("--delay-ms=")) {
      delayMs = parsePositiveInt(arg, "--delay-ms", 1_000, 60_000);
    } else if (arg.startsWith("--page-size=")) {
      pageSize = parsePositiveInt(arg, "--page-size", 1, MAX_PAGE_SIZE);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { limit, days, cacheDir, json, rosterOnly, replayCache, useCache, delayMs, pageSize };
}

function parsePositiveInt(arg: string, name: string, min: number, max: number) {
  const value = Number.parseInt(arg.split("=").slice(1).join("="), 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
  const first = rest.join(",").replace(/\([^)]*\)/g, " ").trim();
  const cleanLast = last.trim();
  return first && cleanLast ? `${first} ${cleanLast}` : value;
}

function removeMiddleInitialTokens(tokens: string[]) {
  if (tokens.length <= 2) return tokens;
  return tokens.filter((token, index) => index === 0 || index === tokens.length - 1 || token.length !== 1);
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
  const honorificStripped = decodeHtmlEntities(value)
    .replace(/^\s*(the\s+honorable|hon\.?|senator|sen\.?|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i, "")
    .trim();
  const reordered = reorderLastFirstName(honorificStripped);
  const tokens = removeMiddleInitialTokens(splitNameTokens(reordered));
  if (tokens.length === 0) return null;
  const normalized = tokens.join(" ");
  return EXPLICIT_NORMALIZED_NAME_ALIASES.get(normalized) ?? normalized;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCsrf(html: string) {
  return html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i)?.[1] ?? null;
}

function formatDateForEfd(date: Date, endOfDay: boolean) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${mm}/${dd}/${yyyy} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function isoDateFromAnyText(value: string) {
  const mdy = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!mdy) return null;
  const [, mm, dd, yyyy] = mdy;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function extractHref(value: string) {
  const href = value.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  if (!href) return null;
  return href.startsWith("http") ? href : new URL(href, HOME_URL).toString();
}

function extractReportType(cells: string[], rowText: string) {
  const joined = cells.join(" ");
  if (/Periodic\s+Transaction\s+Report|\bPTR\b/i.test(joined)) return "Periodic Transaction Report";
  const reportTypeCell = cells.find((cell) => /Report/i.test(stripTags(cell)));
  return reportTypeCell ? stripTags(reportTypeCell) : rowText.slice(0, 80);
}

type ParsedFilerName = {
  name: string | null;
  strategy: string;
};

function normalizeDisplayName(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(Senator|Report|Periodic Transaction Report|Filed)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fullNameFromLastFirst(lastFirst: string) {
  const commaIndex = lastFirst.lastIndexOf(",");
  if (commaIndex < 1) return null;
  const last = normalizeDisplayName(lastFirst.slice(0, commaIndex));
  const first = normalizeDisplayName(lastFirst.slice(commaIndex + 1));
  if (!first || !last) return null;
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}

function collapseRepeatedNameTokens<T extends string>(tokens: T[]) {
  if (tokens.length > 0 && tokens.length % 2 === 0) {
    const midpoint = tokens.length / 2;
    const left = tokens.slice(0, midpoint).map((token) => normalizePersonName(token)).join(" ");
    const right = tokens.slice(midpoint).map((token) => normalizePersonName(token)).join(" ");
    if (left === right) return tokens.slice(0, midpoint);
  }
  return tokens;
}

function splitDisplayNameTokens(value: string) {
  return normalizeDisplayName(value)
    .replace(/[,.'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isSuffixNameToken(token: string) {
  return /^(jr|sr|ii|iii|iv)$/i.test(token.replace(/[,.'’]/g, ""));
}

function withoutSuffixNameTokens<T extends string>(tokens: T[]) {
  return tokens.filter((token) => !isSuffixNameToken(token));
}

function trailingRepeatedNameTokens<T extends string>(tokens: T[]) {
  for (let length = Math.floor(tokens.length / 2); length >= 1; length -= 1) {
    const left = tokens.slice(tokens.length - length * 2, tokens.length - length).map((token) => normalizePersonName(token)).join(" ");
    const right = tokens.slice(tokens.length - length).map((token) => normalizePersonName(token)).join(" ");
    if (left && left === right) return tokens.slice(tokens.length - length);
  }
  return null;
}

function fullNameFromRepeatedSenatorPattern(prefixBeforeSenator: string) {
  const commaIndex = prefixBeforeSenator.lastIndexOf(",");
  if (commaIndex < 1) return null;

  const beforeComma = prefixBeforeSenator.slice(0, commaIndex);
  const firstPart = prefixBeforeSenator.slice(commaIndex + 1);
  const firstTokens = splitNameTokens(firstPart);
  const beforeTokens = splitNameTokens(beforeComma);
  const firstDisplayTokens = withoutSuffixNameTokens(splitDisplayNameTokens(firstPart));
  let beforeDisplayTokens = withoutSuffixNameTokens(splitDisplayNameTokens(beforeComma));
  if (firstTokens.length === 0 || beforeTokens.length === 0) return null;

  if (firstTokens.every((token, index) => beforeTokens[index] === token)) {
    beforeDisplayTokens = beforeDisplayTokens.slice(firstTokens.length);
  }

  while (beforeDisplayTokens.length > 1 && normalizePersonName(beforeDisplayTokens[0])?.length === 1) {
    beforeDisplayTokens = beforeDisplayTokens.slice(1);
  }

  const repeatedSuffixTokens = trailingRepeatedNameTokens(beforeDisplayTokens);
  const lastDisplayTokens = repeatedSuffixTokens ?? collapseRepeatedNameTokens(beforeDisplayTokens);
  if (lastDisplayTokens.length === 0) return null;

  return [...firstDisplayTokens, ...lastDisplayTokens].join(" ");
}

function extractStructuredFilerName(row: unknown, cells: string[]): ParsedFilerName {
  if (row && !Array.isArray(row) && typeof row === "object") {
    const entries = Object.entries(row as Record<string, unknown>);
    const preferred = entries.find(([key, value]) => /filer|senator|name/i.test(key) && !/report|date|url|link/i.test(key) && /[A-Za-z]/.test(stripTags(String(value ?? ""))));
    if (preferred) {
      const text = normalizeDisplayName(stripTags(String(preferred[1] ?? "")));
      const lastFirst = text.includes(",") ? fullNameFromLastFirst(text) : null;
      return { name: lastFirst ?? text, strategy: `structuredField:${preferred[0]}` };
    }
  }

  for (const [index, cell] of cells.entries()) {
    const text = normalizeDisplayName(stripTags(cell));
    if (!text || /Report|Filed|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) continue;
    const lastFirst = text.includes(",") ? fullNameFromLastFirst(text) : null;
    if (lastFirst) return { name: lastFirst, strategy: `cellLastFirst:${index}` };
  }

  for (const [index, cell] of cells.entries()) {
    const text = normalizeDisplayName(stripTags(cell));
    if (!text || /Report|Filed|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) continue;
    if (/[A-Za-z]/.test(text) && text.length <= 120 && text.split(/\s+/).length > 1) {
      return { name: text, strategy: `cellFullName:${index}` };
    }
  }

  return { name: null, strategy: "notParsed" };
}

function extractFilerName(row: unknown, cells: string[], rowText: string): ParsedFilerName {
  const beforeSenator = rowText.match(/^(.+?)\s*\(\s*Senator\s*\)/i)?.[1]?.trim();
  if (beforeSenator) {
    const repeatedPatternName = fullNameFromRepeatedSenatorPattern(beforeSenator);
    if (repeatedPatternName) return { name: repeatedPatternName, strategy: "rowTextRepeatedLastFirstBeforeSenator" };

    const lastFirst = fullNameFromLastFirst(beforeSenator);
    if (lastFirst) return { name: lastFirst, strategy: "rowTextLastFirstBeforeSenator" };
  }

  const structured = extractStructuredFilerName(row, cells);
  if (structured.name) return structured;

  const hon = rowText.match(/The Honorable\s+(.+?)(?:\s+\(|\s+Filed|$)/i);
  if (hon?.[1]) return { name: normalizeDisplayName(hon[1]), strategy: "rowTextHonorable" };

  return { name: null, strategy: "notParsed" };
}

function extractState(rowText: string) {
  const stateMatch = rowText.match(/\b([A-Z]{2})\b/);
  return stateMatch?.[1] ?? null;
}

function reportFromRow(row: unknown): ReportMetadata | null {
  const cells = Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : Object.values(row as Record<string, unknown>).map((cell) => String(cell ?? ""));
  const rowText = stripTags(cells.join(" "));
  const sourceUrl = cells.map(extractHref).find((url): url is string => Boolean(url)) ?? null;
  const reportType = extractReportType(cells, rowText);
  const parsedFiler = extractFilerName(row, cells, rowText);
  const filerName = parsedFiler.name;
  const filingDate = isoDateFromAnyText(rowText);
  const bioguideId = rowText.match(/\b[A-Z]\d{6}\b/)?.[0] ?? null;
  const state = extractState(rowText);

  if (!sourceUrl && !filerName && !filingDate) return null;

  return {
    filerName,
    parsedFullName: filerName,
    filerNameNormalized: normalizePersonName(filerName),
    nameParsingStrategy: parsedFiler.strategy,
    bioguideId,
    state,
    filingDate,
    reportType,
    sourceUrl,
    rowText,
    transactionExtractionPossible: sourceUrl ? /\/search\/view\/ptr\//i.test(sourceUrl) : false,
  };
}


class SenateEfdHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string
  ) {
    super(`Senate eFD request failed: ${status} ${statusText} for ${url}`);
  }
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(setCookieHeaders: string[]) {
    for (const header of setCookieHeaders) {
      const [pair] = header.split(";");
      const [name, ...rest] = pair.split("=");
      if (name && rest.length > 0) this.cookies.set(name.trim(), rest.join("=").trim());
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string) {
    return this.cookies.get(name) ?? null;
  }
}

async function cacheWrite(cacheDir: string, prefix: string, url: string, body: string) {
  await mkdir(cacheDir, { recursive: true });
  const digest = createHash("sha256").update(`${url}\n${body}`).digest("hex").slice(0, 16);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(cacheDir, `${timestamp}-${prefix}-${digest}.txt`);
  await writeFile(path, body, "utf8");
}

async function cachedRead(cacheDir: string, key: string) {
  try {
    return await readFile(join(cacheDir, key), "utf8");
  } catch {
    return null;
  }
}


type CachedReportDataFile = {
  fileName: string;
  path: string;
  mtimeMs: number;
  start: number;
};

async function listCachedReportDataFiles(cacheDir: string): Promise<CachedReportDataFile[]> {
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
    files.push({ fileName, path, mtimeMs: metadata.mtimeMs, start: Number.parseInt(match[1], 10) });
  }

  return files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.start - right.start || left.fileName.localeCompare(right.fileName));
}

function latestCachedReportDataRun(files: CachedReportDataFile[]) {
  if (files.length === 0) return [];
  const newest = files[0].mtimeMs;
  return files
    .filter((file) => newest - file.mtimeMs <= 10 * 60 * 1000)
    .sort((left, right) => left.start - right.start || left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName));
}

async function discoverFromReplayCache(options: Options) {
  const cachedFiles = latestCachedReportDataRun(await listCachedReportDataFiles(options.cacheDir));
  if (cachedFiles.length === 0) {
    throw new Error(
      `No cached Senate report-data files found in ${options.cacheDir}. Run a successful acknowledged live discovery later, or point --cache-dir at a directory containing files named like *-report-data-start-0-*.txt.`
    );
  }

  const reports: ReportMetadata[] = [];
  for (const file of cachedFiles) {
    const responseText = await readFile(file.path, "utf8");
    const parsed = JSON.parse(responseText) as { data?: unknown[] };
    const rows = parsed.data ?? [];
    for (const row of rows) {
      const report = reportFromRow(row);
      if (report) reports.push(report);
      if (reports.length >= options.limit) break;
    }
    if (reports.length >= options.limit) break;
  }

  return {
    reports,
    cacheStats: {
      usedCachedResponses: true,
      wroteResponses: 0,
      noNetworkRequests: true,
      replayedReportDataFiles: cachedFiles.map((file) => file.fileName),
    },
  };
}

function getSetCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const multiple = headers.getSetCookie?.();
  if (multiple && multiple.length > 0) return multiple;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function fetchText(url: string, init: RequestInit, jar: CookieJar) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(url, { ...init, headers, redirect: "follow" });
  jar.store(getSetCookie(response));
  const body = await response.text();
  if (!response.ok) {
    throw new SenateEfdHttpError(response.status, response.statusText, url);
  }
  return body;
}

function buildDataTablesBody(start: number, length: number, days: number) {
  const end = new Date();
  const begin = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams();
  params.set("draw", String(start / length + 1));
  for (let i = 0; i <= 4; i += 1) {
    params.set(`columns[${i}][data]`, String(i));
    params.set(`columns[${i}][name]`, "");
    params.set(`columns[${i}][searchable]`, "true");
    params.set(`columns[${i}][orderable]`, "true");
    params.set(`columns[${i}][search][value]`, "");
    params.set(`columns[${i}][search][regex]`, "false");
  }
  params.set("order[0][column]", "1");
  params.set("order[0][dir]", "desc");
  params.set("start", String(start));
  params.set("length", String(length));
  params.set("search[value]", "");
  params.set("search[regex]", "false");
  params.set("report_types", `[${PTR_REPORT_TYPE_ID}]`);
  params.set("filer_types", `[${SENATOR_FILER_TYPE_ID}]`);
  params.set("submitted_start_date", formatDateForEfd(begin, false));
  params.set("submitted_end_date", formatDateForEfd(end, true));
  params.set("candidate_state", "");
  params.set("senator_state", "");
  params.set("office_id", "");
  params.set("first_name", "");
  params.set("last_name", "");
  return params;
}

async function loadCurrentSenators() {
  return db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      state: politicians.state,
      party: politicians.party,
      bioguideId: politicians.bioguideId,
      dataSource: politicians.dataSource,
      createdAt: politicians.createdAt,
    })
    .from(politicians)
    .where(and(eq(politicians.chamber, "senate"), eq(politicians.isActive, true)))
    .orderBy(politicians.state, politicians.fullName);
}

function tokenSimilarity(left: string | null, right: string | null) {
  const leftTokens = new Set(splitNameTokens(left));
  const rightTokens = new Set(splitNameTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function closeMatchCandidates(report: ReportMetadata, senators: SenatorRow[]): CloseMatchCandidate[] {
  return senators
    .map((senator) => {
      const normalizedName = normalizePersonName(senator.fullName);
      const score = tokenSimilarity(report.filerNameNormalized, normalizedName) + (report.state && senator.state === report.state ? 0.1 : 0);
      return {
        politicianId: senator.id,
        politicianName: senator.fullName,
        state: senator.state,
        party: senator.party,
        normalizedName,
        score: Number(score.toFixed(3)),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.politicianName.localeCompare(b.politicianName))
    .slice(0, 5);
}

function matchReports(reports: ReportMetadata[], senators: SenatorRow[]) {
  const byBioguide = new Map(senators.filter((s) => s.bioguideId).map((s) => [s.bioguideId, s]));
  const byName = new Map<string, SenatorRow[]>();
  for (const senator of senators) {
    const key = normalizePersonName(senator.fullName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), senator]);
  }

  const matched: MatchedReport[] = [];
  const unmatched: UnmatchedReport[] = [];

  for (const report of reports) {
    if (report.bioguideId) {
      const senator = byBioguide.get(report.bioguideId);
      if (senator) {
        matched.push({ ...report, politicianId: senator.id, politicianName: senator.fullName, matchMethod: "bioguideId", matchingStrategy: "bioguideId" });
        continue;
      }
    }

    const candidates = report.filerNameNormalized ? byName.get(report.filerNameNormalized) ?? [] : [];
    if (candidates.length === 1) {
      matched.push({ ...report, politicianId: candidates[0].id, politicianName: candidates[0].fullName, matchMethod: "normalizedName", matchingStrategy: "exactNormalizedName" });
      continue;
    }

    if (candidates.length > 1 && report.state) {
      const stateMatched = candidates.filter((candidate) => candidate.state === report.state);
      if (stateMatched.length === 1) {
        matched.push({ ...report, politicianId: stateMatched[0].id, politicianName: stateMatched[0].fullName, matchMethod: "normalizedNameState", matchingStrategy: "exactNormalizedNameAndState" });
        continue;
      }
    }

    unmatched.push({
      ...report,
      reason: candidates.length > 1 ? "ambiguous_normalized_name" : "no_current_senator_match",
      matchingStrategy: candidates.length > 1 ? "exactNormalizedNameAmbiguous" : "noExactNormalizedNameCandidate",
      closeMatchCandidates: closeMatchCandidates(report, senators),
    });
  }

  return { matched, unmatched };
}

function summarizeRoster(senators: SenatorRow[]): RosterDiagnostics {
  const countByParty: Record<string, number> = {};
  const countByState: Record<string, number> = {};
  const bioguideGroups = new Map<string, SenatorRow[]>();
  const nameStateGroups = new Map<string, { normalizedName: string; state: string | null; senators: SenatorRow[] }>();
  const stateGroups = new Map<string, SenatorRow[]>();

  for (const senator of senators) {
    const party = senator.party ?? "unknown";
    const state = senator.state ?? "unknown";
    countByParty[party] = (countByParty[party] ?? 0) + 1;
    countByState[state] = (countByState[state] ?? 0) + 1;
    stateGroups.set(state, [...(stateGroups.get(state) ?? []), senator]);

    if (senator.bioguideId) bioguideGroups.set(senator.bioguideId, [...(bioguideGroups.get(senator.bioguideId) ?? []), senator]);

    const normalizedName = normalizePersonName(senator.fullName);
    if (normalizedName) {
      const key = `${normalizedName}|${senator.state ?? ""}`;
      const existing = nameStateGroups.get(key) ?? { normalizedName, state: senator.state, senators: [] };
      existing.senators.push(senator);
      nameStateGroups.set(key, existing);
    }
  }

  return {
    countByParty: Object.fromEntries(Object.entries(countByParty).sort(([a], [b]) => a.localeCompare(b))),
    countByState: Object.fromEntries(Object.entries(countByState).sort(([a], [b]) => a.localeCompare(b))),
    duplicateBioguideIds: [...bioguideGroups.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([bioguideId, rows]) => ({
        bioguideId,
        count: rows.length,
        senators: rows.map(({ id, fullName, state, party }) => ({ id, fullName, state, party })),
      })),
    duplicateNormalizedNameStateRows: [...nameStateGroups.values()]
      .filter((group) => group.senators.length > 1)
      .map((group) => ({
        normalizedName: group.normalizedName,
        state: group.state,
        count: group.senators.length,
        senators: group.senators.map(({ id, fullName, state, party, bioguideId }) => ({ id, fullName, state, party, bioguideId })),
      })),
    statesWithMoreThanTwoActiveSenators: [...stateGroups.entries()]
      .filter(([, rows]) => rows.length > 2)
      .sort(([leftState], [rightState]) => leftState.localeCompare(rightState))
      .map(([state, rows]) => ({
        state,
        count: rows.length,
        senators: rows.map(({ id, fullName, state, party, bioguideId, dataSource, createdAt }) => ({ id, fullName, state, party, bioguideId, dataSource, createdAt })),
      })),
  };
}

function summarizeDiagnostics(
  mode: DiscoveryDiagnostics["mode"],
  senators: SenatorRow[],
  reports: ReportMetadata[],
  matched: MatchedReport[],
  unmatched: UnmatchedReport[],
  options: Options,
  failureReasons: string[],
  cacheStats: { usedCachedResponses: boolean; wroteResponses: number; noNetworkRequests?: boolean; replayedReportDataFiles?: string[] }
): DiscoveryDiagnostics {
  const reportTypesFound: Record<string, number> = {};
  const dates = reports.map((report) => report.filingDate).filter((date): date is string => Boolean(date)).sort();
  let possibleCount = 0;
  for (const report of reports) {
    reportTypesFound[report.reportType] = (reportTypesFound[report.reportType] ?? 0) + 1;
    if (report.transactionExtractionPossible) possibleCount += 1;
  }

  return {
    mode,
    dryRun: true,
    source: SOURCE_LABEL,
    generatedAt: new Date().toISOString(),
    currentSenatorsLoaded: senators.length,
    rosterDiagnostics: summarizeRoster(senators),
    metadataReportsDiscovered: reports.length,
    matchedToRoster: matched.length,
    unmatched: unmatched.length,
    reportTypesFound,
    dateRangeDiscovered: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
    transactionExtractionPossible: {
      possibleFromDiscoveredReportUrls: possibleCount > 0,
      possibleCount,
      notPossibleCount: reports.length - possibleCount,
      note: "Phase 0 only checks whether discovered metadata URLs look like Senate PTR view URLs; it does not fetch or parse transaction rows.",
    },
    cache: {
      enabled: true,
      directory: options.cacheDir,
      usedCachedResponses: cacheStats.usedCachedResponses,
      wroteResponses: cacheStats.wroteResponses,
      noNetworkRequests: cacheStats.noNetworkRequests ?? false,
      replayedReportDataFiles: cacheStats.replayedReportDataFiles ?? [],
    },
    rateLimit: { delayMs: options.delayMs, pageSize: options.pageSize, maxReports: options.limit },
    sampleMatchedReports: matched.slice(0, 5),
    sampleUnmatchedReports: unmatched.slice(0, 5),
    skippedOrFailureReasons: failureReasons,
    nextSteps: [
      "Review unmatched reports and name normalization before any import writes.",
      "Phase 1 should fetch a small approved sample of matched PTR view URLs, parse transaction tables to JSON fixtures, and keep disclosure writes disabled by default.",
      "Do not reuse House importer assumptions; keep Senate source labels, idempotency, and diagnostics separate.",
      "Recommended stale-roster cleanup: identify active same-state senators that clearly duplicate canonical current roster rows (for example no-bioguide/no-dataSource rows next to a bioguide-backed row), move any disclosure politicianId references from the stale duplicate to the canonical politician inside a reviewed migration, then deactivate rather than delete the stale row.",
    ],
  };
}

function printDiagnostics(diagnostics: DiscoveryDiagnostics, json: boolean) {
  if (json) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log("Senate disclosure metadata discovery (Phase 0)");
  console.log("================================================");
  console.log(`Mode: ${diagnostics.mode}`);
  console.log(`Dry run: ${diagnostics.dryRun}`);
  console.log(`Source: ${diagnostics.source}`);
  console.log(`Current active senators loaded: ${diagnostics.currentSenatorsLoaded}`);
  console.log(`Roster count by party: ${JSON.stringify(diagnostics.rosterDiagnostics.countByParty)}`);
  console.log(`Roster count by state: ${JSON.stringify(diagnostics.rosterDiagnostics.countByState)}`);
  console.log(`Duplicate bioguide IDs: ${JSON.stringify(diagnostics.rosterDiagnostics.duplicateBioguideIds)}`);
  console.log(`Duplicate normalized name/state rows: ${JSON.stringify(diagnostics.rosterDiagnostics.duplicateNormalizedNameStateRows)}`);
  console.log(`States with >2 active senators: ${JSON.stringify(diagnostics.rosterDiagnostics.statesWithMoreThanTwoActiveSenators)}`);
  console.log(`Metadata reports discovered: ${diagnostics.metadataReportsDiscovered}`);
  console.log(`Matched to roster: ${diagnostics.matchedToRoster}`);
  console.log(`Unmatched: ${diagnostics.unmatched}`);
  console.log(`Report types found: ${JSON.stringify(diagnostics.reportTypesFound)}`);
  console.log(`Date range discovered: ${diagnostics.dateRangeDiscovered.start ?? "n/a"}..${diagnostics.dateRangeDiscovered.end ?? "n/a"}`);
  console.log(`Transaction extraction possible from discovered URLs: ${diagnostics.transactionExtractionPossible.possibleFromDiscoveredReportUrls}`);
  console.log(`Cache: ${diagnostics.cache.directory} (wrote ${diagnostics.cache.wroteResponses}, used cached=${diagnostics.cache.usedCachedResponses}, no network=${diagnostics.cache.noNetworkRequests})`);
  if (diagnostics.cache.replayedReportDataFiles.length > 0) console.log(`Replayed report-data files: ${diagnostics.cache.replayedReportDataFiles.join(", ")}`);
  console.log(`Rate limit: ${diagnostics.rateLimit.delayMs}ms delay, page size ${diagnostics.rateLimit.pageSize}, max reports ${diagnostics.rateLimit.maxReports}`);

  if (diagnostics.skippedOrFailureReasons.length > 0) {
    console.log("\nSkipped/failure reasons:");
    for (const reason of diagnostics.skippedOrFailureReasons) console.log(`- ${reason}`);
  }

  console.log("\nSample matched reports:");
  console.log(JSON.stringify(diagnostics.sampleMatchedReports, null, 2));
  console.log("\nSample unmatched reports:");
  console.log(JSON.stringify(diagnostics.sampleUnmatchedReports, null, 2));
  console.log("\nNext steps:");
  for (const step of diagnostics.nextSteps) console.log(`- ${step}`);
}

async function discoverFromSenateEfd(options: Options) {
  const jar = new CookieJar();
  let wroteResponses = 0;
  let usedCachedResponses = false;
  const commonHeaders = {
    "User-Agent": "Trawl Senate disclosure metadata discovery/0.1 (+https://efdsearch.senate.gov/search/home/)",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const homeCache = options.useCache ? await cachedRead(options.cacheDir, "latest-home.html") : null;
  let homeHtml = homeCache;
  if (homeHtml) {
    usedCachedResponses = true;
  } else {
    homeHtml = await fetchText(HOME_URL, { method: "GET", headers: { ...commonHeaders, Accept: "text/html" } }, jar);
    await cacheWrite(options.cacheDir, "home", HOME_URL, homeHtml);
    await writeFile(join(options.cacheDir, "latest-home.html"), homeHtml, "utf8");
    wroteResponses += 1;
    await sleep(options.delayMs);
  }

  const csrf = extractCsrf(homeHtml);
  if (!csrf) throw new Error("Could not find csrfmiddlewaretoken on Senate eFD acknowledgement page.");

  const acknowledgeBody = new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: csrf });
  const acknowledgedHtml = await fetchText(
    HOME_URL,
    {
      method: "POST",
      headers: {
        ...commonHeaders,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: HOME_URL,
        Origin: "https://efdsearch.senate.gov",
        "X-CSRFToken": jar.get("csrftoken") ?? csrf,
      },
      body: acknowledgeBody,
    },
    jar
  );
  await cacheWrite(options.cacheDir, "acknowledged", HOME_URL, acknowledgedHtml);
  wroteResponses += 1;
  await sleep(options.delayMs);

  const reports: ReportMetadata[] = [];
  for (let start = 0; start < options.limit; start += options.pageSize) {
    const length = Math.min(options.pageSize, options.limit - start);
    const body = buildDataTablesBody(start, length, options.days);
    const responseText = await fetchText(
      REPORT_DATA_URL,
      {
        method: "POST",
        headers: {
          ...commonHeaders,
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://efdsearch.senate.gov/search/",
          Origin: "https://efdsearch.senate.gov",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": jar.get("csrftoken") ?? csrf,
        },
        body,
      },
      jar
    );
    await cacheWrite(options.cacheDir, `report-data-start-${start}`, REPORT_DATA_URL, responseText);
    wroteResponses += 1;

    const parsed = JSON.parse(responseText) as { data?: unknown[] };
    const rows = parsed.data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const report = reportFromRow(row);
      if (report) reports.push(report);
      if (reports.length >= options.limit) break;
    }
    if (reports.length >= options.limit || rows.length < length) break;
    await sleep(options.delayMs);
  }

  return { reports, cacheStats: { usedCachedResponses, wroteResponses, noNetworkRequests: false, replayedReportDataFiles: [] } };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const senators = await loadCurrentSenators();
  const failureReasons: string[] = [];

  if (options.rosterOnly) {
    const diagnostics = summarizeDiagnostics("roster-only", senators, [], [], [], options, ["--roster-only set; no Senate eFD requests attempted."], {
      usedCachedResponses: false,
      wroteResponses: 0,
      noNetworkRequests: true,
      replayedReportDataFiles: [],
    });
    printDiagnostics(diagnostics, options.json);
    return;
  }

  if (options.replayCache) {
    failureReasons.push("--replay-cache set; loaded cached report-data responses only and made no Senate eFD network requests.");
    const { reports, cacheStats } = await discoverFromReplayCache(options);
    const { matched, unmatched } = matchReports(reports, senators);
    const diagnostics = summarizeDiagnostics("cache-replay", senators, reports, matched, unmatched, options, failureReasons, cacheStats);
    printDiagnostics(diagnostics, options.json);
    return;
  }

  if (process.env.SENATE_EFD_ACKNOWLEDGED !== "true") {
    failureReasons.push(
      "Senate eFD requires acknowledgement of statutory use prohibitions before searching. Set SENATE_EFD_ACKNOWLEDGED=true only after reviewing and accepting the official acknowledgement at https://efdsearch.senate.gov/search/home/. No eFD requests were made."
    );
    const diagnostics = summarizeDiagnostics("blocked", senators, [], [], [], options, failureReasons, {
      usedCachedResponses: false,
      wroteResponses: 0,
      noNetworkRequests: true,
      replayedReportDataFiles: [],
    });
    printDiagnostics(diagnostics, options.json);
    process.exitCode = 2;
    return;
  }

  try {
    const { reports, cacheStats } = await discoverFromSenateEfd(options);
    const { matched, unmatched } = matchReports(reports, senators);
    const diagnostics = summarizeDiagnostics("discovered", senators, reports, matched, unmatched, options, failureReasons, cacheStats);
    printDiagnostics(diagnostics, options.json);
  } catch (error) {
    if (error instanceof SenateEfdHttpError && error.status === 403) {
      failureReasons.push(
        `Senate eFD returned 403 Forbidden for ${error.url}. The public site blocked this request; no bypass was attempted, and the response body was intentionally not printed. Use --replay-cache for parser/matching diagnostics, or try again manually later after reviewing the official Senate eFD site.`
      );
      const diagnostics = summarizeDiagnostics("blocked", senators, [], [], [], options, failureReasons, {
        usedCachedResponses: false,
        wroteResponses: 0,
        noNetworkRequests: false,
        replayedReportDataFiles: [],
      });
      printDiagnostics(diagnostics, options.json);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
