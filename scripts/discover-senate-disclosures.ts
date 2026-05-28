import { mkdir, readFile, writeFile } from "node:fs/promises";
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
};

type ReportMetadata = {
  filerName: string | null;
  filerNameNormalized: string | null;
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
};

type UnmatchedReport = ReportMetadata & {
  reason: string;
};

type DiscoveryDiagnostics = {
  mode: "roster-only" | "blocked" | "discovered";
  dryRun: true;
  source: string;
  generatedAt: string;
  currentSenatorsLoaded: number;
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
  let delayMs = DEFAULT_DELAY_MS;
  let pageSize = MAX_PAGE_SIZE;

  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--roster-only") rosterOnly = true;
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

  return { limit, days, cacheDir, json, rosterOnly, useCache, delayMs, pageSize };
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

function normalizePersonName(value: string | null) {
  if (!value) return null;
  const withoutHonorifics = decodeHtmlEntities(value)
    .replace(/^\s*(the\s+honorable|hon\.?|senator|sen\.?|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i, "")
    .replace(/\s+\([^)]*\)\s*$/g, " ")
    .replace(/[,.'’\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return withoutHonorifics || null;
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

function extractFilerName(cells: string[], rowText: string) {
  for (const cell of cells) {
    const text = stripTags(cell);
    if (!text || /Report|Filed|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) continue;
    const parenName = text.match(/\(([^,()]+),\s*([^()]+)\)/);
    if (parenName?.[1] && parenName?.[2]) {
      return `${parenName[2].trim()} ${parenName[1].trim()}`.replace(/\s+/g, " ");
    }
    if (/[A-Za-z]/.test(text) && text.length <= 120) return text;
  }
  const hon = rowText.match(/The Honorable\s+(.+?)(?:\s+\(|\s+Filed|$)/i);
  return hon?.[1]?.trim() ?? null;
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
  const filerName = extractFilerName(cells, rowText);
  const filingDate = isoDateFromAnyText(rowText);
  const bioguideId = rowText.match(/\b[A-Z]\d{6}\b/)?.[0] ?? null;
  const state = extractState(rowText);

  if (!sourceUrl && !filerName && !filingDate) return null;

  return {
    filerName,
    filerNameNormalized: normalizePersonName(filerName),
    bioguideId,
    state,
    filingDate,
    reportType,
    sourceUrl,
    rowText,
    transactionExtractionPossible: sourceUrl ? /\/search\/view\/ptr\//i.test(sourceUrl) : false,
  };
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
    throw new Error(`Senate eFD request failed: ${response.status} ${response.statusText} for ${url}. Body: ${body.slice(0, 240)}`);
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
    })
    .from(politicians)
    .where(and(eq(politicians.chamber, "senate"), eq(politicians.isActive, true)))
    .orderBy(politicians.state, politicians.fullName);
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
        matched.push({ ...report, politicianId: senator.id, politicianName: senator.fullName, matchMethod: "bioguideId" });
        continue;
      }
    }

    const candidates = report.filerNameNormalized ? byName.get(report.filerNameNormalized) ?? [] : [];
    if (candidates.length === 1) {
      matched.push({ ...report, politicianId: candidates[0].id, politicianName: candidates[0].fullName, matchMethod: "normalizedName" });
      continue;
    }

    if (candidates.length > 1 && report.state) {
      const stateMatched = candidates.filter((candidate) => candidate.state === report.state);
      if (stateMatched.length === 1) {
        matched.push({ ...report, politicianId: stateMatched[0].id, politicianName: stateMatched[0].fullName, matchMethod: "normalizedNameState" });
        continue;
      }
    }

    unmatched.push({
      ...report,
      reason: candidates.length > 1 ? "ambiguous_normalized_name" : "no_current_senator_match",
    });
  }

  return { matched, unmatched };
}

function summarizeDiagnostics(
  mode: DiscoveryDiagnostics["mode"],
  senators: SenatorRow[],
  reports: ReportMetadata[],
  matched: MatchedReport[],
  unmatched: UnmatchedReport[],
  options: Options,
  failureReasons: string[],
  cacheStats: { usedCachedResponses: boolean; wroteResponses: number }
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
    },
    rateLimit: { delayMs: options.delayMs, pageSize: options.pageSize, maxReports: options.limit },
    sampleMatchedReports: matched.slice(0, 5),
    sampleUnmatchedReports: unmatched.slice(0, 5),
    skippedOrFailureReasons: failureReasons,
    nextSteps: [
      "Review unmatched reports and name normalization before any import writes.",
      "Phase 1 should fetch a small approved sample of matched PTR view URLs, parse transaction tables to JSON fixtures, and keep disclosure writes disabled by default.",
      "Do not reuse House importer assumptions; keep Senate source labels, idempotency, and diagnostics separate.",
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
  console.log(`Metadata reports discovered: ${diagnostics.metadataReportsDiscovered}`);
  console.log(`Matched to roster: ${diagnostics.matchedToRoster}`);
  console.log(`Unmatched: ${diagnostics.unmatched}`);
  console.log(`Report types found: ${JSON.stringify(diagnostics.reportTypesFound)}`);
  console.log(`Date range discovered: ${diagnostics.dateRangeDiscovered.start ?? "n/a"}..${diagnostics.dateRangeDiscovered.end ?? "n/a"}`);
  console.log(`Transaction extraction possible from discovered URLs: ${diagnostics.transactionExtractionPossible.possibleFromDiscoveredReportUrls}`);
  console.log(`Cache: ${diagnostics.cache.directory} (wrote ${diagnostics.cache.wroteResponses}, used cached=${diagnostics.cache.usedCachedResponses})`);
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

  return { reports, cacheStats: { usedCachedResponses, wroteResponses } };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const senators = await loadCurrentSenators();
  const failureReasons: string[] = [];

  if (options.rosterOnly) {
    const diagnostics = summarizeDiagnostics("roster-only", senators, [], [], [], options, ["--roster-only set; no Senate eFD requests attempted."], {
      usedCachedResponses: false,
      wroteResponses: 0,
    });
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
    });
    printDiagnostics(diagnostics, options.json);
    process.exitCode = 2;
    return;
  }

  const { reports, cacheStats } = await discoverFromSenateEfd(options);
  const { matched, unmatched } = matchReports(reports, senators);
  const diagnostics = summarizeDiagnostics("discovered", senators, reports, matched, unmatched, options, failureReasons, cacheStats);
  printDiagnostics(diagnostics, options.json);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
