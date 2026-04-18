import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNull } from "drizzle-orm";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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

const ASSET_NAME_TO_TICKER: Record<string, string> = {
  "ALPHABET INC": "GOOGL",
  "AMAZON.COM INC": "AMZN",
  "APPLE INC": "AAPL",
  "MICROSOFT CORP": "MSFT",
  "NVIDIA CORP": "NVDA",
  "TESLA INC": "TSLA",
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
};

type ImportStats = {
  inserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
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

function resolveTicker(rawTicker: string | null, assetName: string): string | null {
  if (rawTicker) {
    const clean = rawTicker.trim().toUpperCase();
    if (/^[A-Z.\-]{1,10}$/.test(clean)) {
      return clean;
    }
  }

  const normalizedAsset = assetName
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return ASSET_NAME_TO_TICKER[normalizedAsset] ?? null;
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

  const ticker = resolveTicker(getValue(row, ["ticker", "symbol"]), assetName);

  return {
    politicianName,
    party: normalizeParty(getValue(row, ["party"])),
    state: getValue(row, ["state", "district state", "st"]),
    chamber: "house",
    ticker,
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

    return { rows: bestRows, zipEntries: entries, selectedFile, selectedHeaders: bestHeaders };
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
    console.log(`🧪 ${year}: first ${Math.min(10, sourceRows.length)} source rows:`);
    sourceRows.slice(0, 10).forEach((row, index) => {
      console.log(`   [${index + 1}] ${JSON.stringify(row)}`);
    });

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

  console.log(`🧪 Normalized ${normalizedRows.length} disclosure row(s).`);
  console.log(`🧪 Rejected ${rejectedRows} row(s) during normalization.`);
  console.log("🧪 Normalization failure reasons:");
  for (const [reason, count] of [...failureReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${reason}: ${count}`);
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
