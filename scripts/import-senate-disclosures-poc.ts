import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  }

  return { limit, year, inputFile };
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
  return date.toISOString();
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
  const stripped = stripTags(body);
  const parsed = normalizeFromText(`file://${absolutePath}`, stripped);
  if (parsed.row) normalized.push(parsed.row);
  else if (parsed.failure) failures.push(parsed.failure);
  console.log(`Manual input mode used. file=${absolutePath}`);
}

async function main() {
  const { limit, year, inputFile } = parseArgs();
  const normalized: SenateNormalizedDisclosure[] = [];
  const failures: ParseFailure[] = [];

  console.log(`Starting Senate PTR POC (read-only). limit=${limit}${year ? ` year=${year}` : ""}`);
  console.log("No DB writes. No schema changes. No pipeline integration.");
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

  console.log("\nNormalized sample rows:");
  console.log(JSON.stringify(normalized, null, 2));

  console.log(`\nDone. normalized=${normalized.length} failures=${failures.length}`);
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
