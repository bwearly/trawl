import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { normalizeTradeType } from "../lib/domain/pipeline/normalization";

type SenateNormalizedDisclosure = {
  politicianName: string;
  chamber: "senate";
  party: string | null;
  state: string | null;
  ticker: string | null;
  assetName: string;
  assetType: string;
  tradeType: "purchase" | "sale" | "exchange";
  ownerType: "self" | "spouse" | "dependent" | "joint" | "unknown";
  amountRangeLabel: string | null;
  tradeDate: string | null;
  filingDate: string | null;
  filingLagDays: number | null;
  sourceUrl: string;
  sourceLabel: "Senate Financial Disclosure";
};

type ParseFailure = {
  sourceUrl: string;
  reason: string;
  detail?: string;
};

const SOURCE_LABEL = "Senate Financial Disclosure" as const;
const HOME_URL = "https://efdsearch.senate.gov/search/home/";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const REQUEST_DELAY_MS = 1250;

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let year: number | null = null;
  let inputFile: string | null = null;
  let write = false;

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = Math.min(value, MAX_LIMIT);
    }
    if (arg.startsWith("--year=")) {
      const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isFinite(value) || value < 1990 || value > 2100) {
        throw new Error(`Invalid --year value: ${arg}`);
      }
      year = value;
    }
    if (arg.startsWith("--input-file=")) {
      const value = arg.split("=")[1]?.trim();
      if (!value) throw new Error(`Invalid --input-file value: ${arg}`);
      inputFile = value;
    }
    if (arg === "--write") write = true;
  }

  return { limit, year, inputFile, write };
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function inferOwnerType(raw: string | null): SenateNormalizedDisclosure["ownerType"] {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("joint")) return "joint";
  if (v.includes("spouse")) return "spouse";
  if (v.includes("dependent") || v.includes("child")) return "dependent";
  if (v.includes("self")) return "self";
  return "unknown";
}

function inferAssetType(assetName: string) {
  const value = assetName.toLowerCase();
  if (value.includes("etf")) return "etf";
  if (value.includes("option") || value.includes("call") || value.includes("put")) return "option";
  if (value.includes("stock") || value.includes("inc") || value.includes("corp") || value.includes("class ")) return "stock";
  return "other";
}

function extractTicker(assetName: string): string | null {
  const direct = assetName.match(/\(([A-Z]{1,5}(?:\.[A-Z])?)\)/);
  if (direct) return direct[1] ?? null;
  const prefixed = assetName.match(/\b(?:Ticker|Symbol)\s*[:\-]\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/i);
  if (prefixed) return (prefixed[1] ?? "").toUpperCase();
  return null;
}

function extractLineValue(content: string, label: string): string | null {
  const pattern = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n\\r<]+)`, "i");
  const m = content.match(pattern);
  return m?.[1]?.trim() ?? null;
}

function stripTags(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function htmlCellText(value: string) {
  return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, " ").trim();
}

function normalizePoliticianName(raw: string) {
  const withoutHonorific = raw.replace(/^The Honorable\s+/i, "").trim();
  const parenMatch = withoutHonorific.match(/\(([^)]+)\)/);
  if (parenMatch?.[1]) {
    const inner = parenMatch[1].trim();
    const lastFirst = inner.match(/^([^,]+),\s*(.+)$/);
    if (lastFirst?.[1] && lastFirst?.[2]) {
      const firstName = lastFirst[2].trim().split(/\s+/)[0] ?? lastFirst[2].trim();
      return `${firstName} ${lastFirst[1].trim()}`;
    }
  }
  return withoutHonorific.replace(/\s*\([^)]*\)\s*$/, "").trim();
}


function compactSnippet(value: string, maxLength = 140) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function cleanHtmlText(html: string) {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

function extractReportLevelFields(body: string) {
  const h2Match = body.match(/<h2[^>]*class=["'][^"']*filedReport[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
  const politicianBlock = h2Match?.[1] ?? "";
  const politicianRaw = cleanHtmlText(politicianBlock);

  const filedStrongMatch = body.match(/<strong[^>]*class=["'][^"']*noWrap[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i);
  const filingBlock = filedStrongMatch?.[1] ?? "";
  const filingText = cleanHtmlText(filingBlock);

  const filingDateMatch = filingText.match(/\bFiled\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i);
  const filingDateRaw = filingDateMatch?.[1] ?? "";

  return {
    politicianRaw,
    filingDateRaw,
    debug: {
      politicianSnippet: compactSnippet(cleanHtmlText(politicianBlock)),
      filingSnippet: compactSnippet(filingText),
    },
  };
}

function discoverReportUrls(html: string, limit: number) {
  const links = new Set<string>();
  const regex = /href=["']([^"']*(?:\/search\/(?:view|report)[^"']*|\/search\/view\/ptr\/[^"]*))["']/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null && links.size < limit) {
    const path = match[1] ?? "";
    if (!path) continue;
    const absolute = path.startsWith("http") ? path : new URL(path, HOME_URL).toString();
    links.add(absolute);
  }

  return [...links].slice(0, limit);
}

function normalizeFromText(sourceUrl: string, text: string): { row: SenateNormalizedDisclosure | null; failure: ParseFailure | null } {
  const filerName = extractLineValue(text, "Filer|Name|Senator");
  const assetName = extractLineValue(text, "Asset|Issuer|Description");
  const tradeTypeRaw = extractLineValue(text, "Type|Transaction Type");
  const tradeDateRaw = extractLineValue(text, "Transaction Date|Trade Date");
  const filingDateRaw = extractLineValue(text, "Date Filed|Notification Date|Filing Date");
  const amountRangeLabel = extractLineValue(text, "Amount|Amount Range");
  const ownerRaw = extractLineValue(text, "Owner|Owner Type");
  const state = extractLineValue(text, "State");
  const party = extractLineValue(text, "Party");

  if (!filerName || !assetName || !tradeTypeRaw) {
    return {
      row: null,
      failure: {
        sourceUrl,
        reason: "insufficient_fields",
        detail: `name=${Boolean(filerName)} asset=${Boolean(assetName)} type=${Boolean(tradeTypeRaw)}`,
      },
    };
  }

  const tradeDate = parseDate(tradeDateRaw);
  const filingDate = parseDate(filingDateRaw);
  const filingLagDays = tradeDate && filingDate ? Math.floor((filingDate.getTime() - tradeDate.getTime()) / 86400000) : null;

  return {
    row: {
      politicianName: filerName,
      chamber: "senate",
      party: party || null,
      state: state || null,
      ticker: extractTicker(assetName),
      assetName,
      assetType: inferAssetType(assetName),
      tradeType: normalizeTradeType(tradeTypeRaw),
      ownerType: inferOwnerType(ownerRaw),
      amountRangeLabel: amountRangeLabel || null,
      tradeDate: toIsoDate(tradeDate),
      filingDate: toIsoDate(filingDate),
      filingLagDays,
      sourceUrl,
      sourceLabel: SOURCE_LABEL,
    },
    failure: null,
  };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "TrawlSenatePOC/0.1 (research-only; respectful low-volume fetch)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (response.status === 403 || response.status === 429) {
    throw new Error(`Access blocked by source (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function runManualInputMode(inputFile: string, normalized: SenateNormalizedDisclosure[], failures: ParseFailure[]) {
  const { readFile } = await import("node:fs/promises");
  const absolutePath = resolve(inputFile);
  const body = await readFile(absolutePath, "utf8");
  const sourceUrl = `file://${absolutePath}`;

  const reportFields = extractReportLevelFields(body);
  const politicianLabel = reportFields.politicianRaw;
  const filingDateRaw = reportFields.filingDateRaw;

  const tableMatch = body.match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  const transactionTable = tableMatch.find((tableHtml) => {
    const tableText = htmlCellText(tableHtml).toLowerCase();
    return tableText.includes("transaction date") && tableText.includes("asset name") && tableText.includes("amount");
  });

  if (!transactionTable || !politicianLabel || !filingDateRaw) {
    failures.push({
      sourceUrl,
      reason: "manual_html_parse_failed",
      detail: `table=${Boolean(transactionTable)} politician=${Boolean(politicianLabel)} filingDate=${Boolean(filingDateRaw)} politicianSnippet="${reportFields.debug.politicianSnippet || "n/a"}" filingSnippet="${reportFields.debug.filingSnippet || "n/a"}"`,
    });
    console.log(`Manual input mode used. file=${absolutePath}`);
    return;
  }

  const rowMatches = [...transactionTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length < 2) {
    failures.push({ sourceUrl, reason: "manual_html_no_rows" });
    console.log(`Manual input mode used. file=${absolutePath}`);
    return;
  }

  const headerCells = [...(rowMatches[0]?.[1] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => htmlCellText(m[1] ?? ""));
  const headerIndex = new Map<string, number>();
  headerCells.forEach((header, index) => headerIndex.set(header.toLowerCase(), index));

  const requiredHeaders = ["transaction date", "owner", "ticker", "asset name", "asset type", "type", "amount", "comment"];
  if (requiredHeaders.some((header) => !headerIndex.has(header))) {
    failures.push({ sourceUrl, reason: "manual_html_missing_headers", detail: headerCells.join(" | ") });
    console.log(`Manual input mode used. file=${absolutePath}`);
    return;
  }

  const politicianName = normalizePoliticianName(politicianLabel);
  const filingDate = parseDate(filingDateRaw);

  for (const rowMatch of rowMatches.slice(1)) {
    const cellMatches = [...(rowMatch[1] ?? "").matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
    if (cellMatches.length === 0) continue;
    const cells = cellMatches.map((m) => htmlCellText(m[1] ?? ""));
    const tradeTypeRaw = cells[headerIndex.get("type") ?? -1] ?? "";
    const assetName = cells[headerIndex.get("asset name") ?? -1] ?? "";
    const tradeDateRaw = cells[headerIndex.get("transaction date") ?? -1] ?? "";
    if (!tradeTypeRaw || !assetName || !tradeDateRaw) continue;

    const tradeDate = parseDate(tradeDateRaw);
    const filingLagDays = tradeDate && filingDate ? Math.floor((filingDate.getTime() - tradeDate.getTime()) / 86400000) : null;
    normalized.push({
      politicianName,
      chamber: "senate",
      party: null,
      state: null,
      ticker: (cells[headerIndex.get("ticker") ?? -1] ?? "").toUpperCase() || extractTicker(assetName),
      assetName,
      assetType: cells[headerIndex.get("asset type") ?? -1] ?? inferAssetType(assetName),
      tradeType: normalizeTradeType(tradeTypeRaw),
      ownerType: inferOwnerType(cells[headerIndex.get("owner") ?? -1] ?? null),
      amountRangeLabel: cells[headerIndex.get("amount") ?? -1] ?? null,
      tradeDate: toIsoDate(tradeDate),
      filingDate: toIsoDate(filingDate),
      filingLagDays,
      sourceUrl,
      sourceLabel: SOURCE_LABEL,
    });
  }

  if (normalized.length === 0) {
    failures.push({ sourceUrl, reason: "manual_html_rows_not_normalized" });
  }
  console.log(`Manual input mode used. file=${absolutePath}`);
}

async function findOrCreatePolitician(row: SenateNormalizedDisclosure) {
  const { db } = await import("../lib/db");
  const { politicians } = await import("../lib/db/schema");
  const existing = await db
    .select({ id: politicians.id })
    .from(politicians)
    .where(and(eq(politicians.fullName, row.politicianName), eq(politicians.chamber, "senate")))
    .limit(1);

  if (existing[0]?.id) return { politicianId: existing[0].id, created: false };

  const inserted = await db
    .insert(politicians)
    .values({
      fullName: row.politicianName,
      chamber: "senate",
      party: row.party,
      state: row.state,
    })
    .returning({ id: politicians.id });

  return { politicianId: inserted[0]?.id ?? null, created: true };
}

function toDbDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

async function disclosureExists(politicianId: number, row: SenateNormalizedDisclosure) {
  const { db } = await import("../lib/db");
  const { disclosures } = await import("../lib/db/schema");
  const tickerFilter = row.ticker ? eq(disclosures.ticker, row.ticker) : isNull(disclosures.ticker);
  const amountFilter = row.amountRangeLabel
    ? eq(disclosures.amountRangeLabel, row.amountRangeLabel)
    : isNull(disclosures.amountRangeLabel);
  const tradeDate = toDbDate(row.tradeDate);
  const filingDate = toDbDate(row.filingDate);
  const tradeDateFilter = tradeDate ? eq(disclosures.tradeDate, tradeDate) : isNull(disclosures.tradeDate);
  const filingDateFilter = filingDate ? eq(disclosures.filingDate, filingDate) : isNull(disclosures.filingDate);

  const existing = await db
    .select({ id: disclosures.id })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.politicianId, politicianId),
        eq(disclosures.assetName, row.assetName),
        eq(disclosures.tradeType, row.tradeType),
        eq(disclosures.ownerType, row.ownerType),
        eq(disclosures.sourceLabel, row.sourceLabel),
        eq(disclosures.assetType, row.assetType),
        tickerFilter,
        amountFilter,
        tradeDateFilter,
        filingDateFilter
      )
    )
    .limit(1);

  return Boolean(existing[0]?.id);
}

async function main() {
  const { limit, year, inputFile, write } = parseArgs();
  const normalized: SenateNormalizedDisclosure[] = [];
  const failures: ParseFailure[] = [];
  const uniquePoliticianKeyToId = new Map<string, number>();
  let politiciansCreated = 0;
  let politiciansReused = 0;
  let disclosuresInserted = 0;
  let disclosuresSkippedDuplicates = 0;

  console.log(`Starting Senate PTR POC (${write ? "write mode" : "read-only"}). limit=${limit}${year ? ` year=${year}` : ""}`);
  console.log(write ? "DB writes enabled via --write. No schema changes. No pipeline integration." : "No DB writes. No schema changes. No pipeline integration.");
  if (inputFile) {
    await runManualInputMode(inputFile, normalized, failures);
  } else {
    console.log("Network mode used. NOTE: This POC only performs tiny public fetches and does not bypass access controls.");

    let homeHtml = "";
    try {
      homeHtml = await fetchText(HOME_URL);
    } catch (error) {
      failures.push({ sourceUrl: HOME_URL, reason: "home_fetch_failed", detail: error instanceof Error ? error.message : String(error) });
    }

    const reportUrls = homeHtml ? discoverReportUrls(homeHtml, limit) : [];

    if (reportUrls.length === 0) {
      failures.push({
        sourceUrl: HOME_URL,
        reason: "no_report_links_discovered",
        detail: "Likely due to eFD access gating/terms flow or changed page structure.",
      });
    }

    for (const url of reportUrls) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const html = await fetchText(url);
        const text = stripTags(html);
        const parsed = normalizeFromText(url, text);

        if (parsed.row) normalized.push(parsed.row);
        else if (parsed.failure) failures.push(parsed.failure);
      } catch (error) {
        failures.push({ sourceUrl: url, reason: "report_fetch_or_parse_failed", detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await mkdir(resolve("tmp"), { recursive: true });
  await writeFile(resolve("tmp/senate-poc-normalized.json"), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await writeFile(resolve("tmp/senate-poc-failures.json"), `${JSON.stringify(failures, null, 2)}\n`, "utf8");

  if (write) {
    const { db } = await import("../lib/db");
    const { disclosures } = await import("../lib/db/schema");
    for (const row of normalized) {
      try {
        const key = `${row.politicianName}::${row.chamber}`;
        let politicianId = uniquePoliticianKeyToId.get(key);
        if (!politicianId) {
          const result = await findOrCreatePolitician(row);
          if (!result.politicianId) {
            failures.push({ sourceUrl: row.sourceUrl, reason: "politician_upsert_failed", detail: row.politicianName });
            continue;
          }
          politicianId = result.politicianId;
          uniquePoliticianKeyToId.set(key, politicianId);
          if (result.created) politiciansCreated += 1;
          else politiciansReused += 1;
        }

        const exists = await disclosureExists(politicianId, row);
        if (exists) {
          disclosuresSkippedDuplicates += 1;
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
          tradeDate: toDbDate(row.tradeDate),
          filingDate: toDbDate(row.filingDate),
          filingLagDays: row.filingLagDays,
          sourceUrl: row.sourceUrl,
          sourceLabel: row.sourceLabel,
        });
        disclosuresInserted += 1;
      } catch (error) {
        failures.push({ sourceUrl: row.sourceUrl, reason: "db_write_failed", detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  console.log("\nNormalized sample rows:");
  console.log(JSON.stringify(normalized, null, 2));

  console.log(`\nDone. normalized=${normalized.length} failures=${failures.length}`);
  console.log(
    `DB summary: politicians_created=${politiciansCreated} politicians_reused=${politiciansReused} disclosures_inserted=${disclosuresInserted} disclosures_skipped_duplicates=${disclosuresSkippedDuplicates}`
  );
  console.log(`Records attempted=${inputFile ? 1 : limit}`);
  if (!inputFile && failures.some((f) => f.reason === "home_fetch_failed" || f.reason === "no_report_links_discovered")) {
    console.log("Access limitation note: Senate eFD appears to require additional interactive/session flow not captured by direct fetch in this environment.");
  }
  console.log("Wrote tmp/senate-poc-normalized.json and tmp/senate-poc-failures.json");
}

main().catch((error) => {
  console.error("Senate POC importer failed:", error);
  process.exit(1);
});
