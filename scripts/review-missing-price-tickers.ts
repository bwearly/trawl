import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";
import { disclosures, politicians, priceHistory } from "../lib/db/schema";
import { classifyMissingPriceTicker, type MissingPriceClassification } from "../lib/domain/pipeline/missing-price-classification";
import { normalizeTickerForStorage, normalizeYahooSymbol } from "../lib/domain/pipeline/normalization";
import { sql } from "drizzle-orm";

type PriceImportFailure = {
  ticker: string;
  yahooSymbol: string;
  reason: string;
  detail: string;
};

type ReportRow = {
  rawTicker: string;
  storageTicker: string;
  yahooLookupTicker: string;
  disclosureCount: number;
  firstDisclosureDate: string | null;
  lastDisclosureDate: string | null;
  samplePoliticians: string[];
  sampleAssetNames: string[];
  importFailureReason: string | null;
  importFailureDetail: string | null;
  classification: MissingPriceClassification;
  classificationReason: string;
};

const GROUP_ORDER: MissingPriceClassification[] = [
  "unknown",
  "manual_review",
  "likely_false_positive_parser_noise",
  "unsupported_share_class_or_symbol_format",
  "expected_delisted_or_acquired",
  "yahoo_provider_or_schema_issue",
];

async function main() {
  const unresolvedPriceImportPath = "tmp/price-import-unresolved-symbols.json";
  const unresolvedPriceImport: PriceImportFailure[] = existsSync(unresolvedPriceImportPath)
    ? JSON.parse(readFileSync(unresolvedPriceImportPath, "utf8"))
    : [];

  if (!existsSync(unresolvedPriceImportPath)) {
    console.warn(
      "Warning: tmp/price-import-unresolved-symbols.json not found. Run npm run prices:import for import failure details."
    );
  }

  const unresolvedByTicker = new Map(
    unresolvedPriceImport.map((row) => [normalizeTickerForStorage(row.ticker), row])
  );

  const missingTickerRows = await db.execute(sql`
    select
      upper(d.ticker) as raw_ticker,
      count(*)::int as disclosure_count,
      min(coalesce(d.trade_date, d.filing_date))::date as first_disclosure_date,
      max(coalesce(d.trade_date, d.filing_date))::date as last_disclosure_date,
      array_remove((array_agg(distinct p.full_name order by p.full_name))[1:3], null) as sample_politicians,
      array_remove((array_agg(distinct d.asset_name order by d.asset_name))[1:3], null) as sample_asset_names
    from ${disclosures} d
    inner join ${politicians} p on p.id = d.politician_id
    left join ${priceHistory} ph on upper(ph.ticker) = upper(d.ticker)
    where d.ticker is not null and btrim(d.ticker) <> '' and ph.id is null
    group by upper(d.ticker)
  `);

  const rows: ReportRow[] = missingTickerRows.rows.map((row) => {
    const rawTicker = String((row as { raw_ticker: string }).raw_ticker ?? "").trim().toUpperCase();
    const storageTicker = normalizeTickerForStorage(rawTicker);
    const yahooLookupTicker = normalizeYahooSymbol(storageTicker);
    const importFailure = unresolvedByTicker.get(storageTicker);
    const sampleAssetNames = Array.isArray((row as { sample_asset_names: unknown }).sample_asset_names)
      ? ((row as { sample_asset_names: string[] }).sample_asset_names ?? [])
      : [];

    const { classification, classificationReason } = classifyMissingPriceTicker({
      rawTicker,
      storageTicker,
      yahooLookupTicker,
      sampleAssetNames,
      importFailureReason: importFailure?.reason ?? null,
      importFailureDetail: importFailure?.detail ?? null,
    });

    return {
      rawTicker,
      storageTicker,
      yahooLookupTicker,
      disclosureCount: Number((row as { disclosure_count: number }).disclosure_count ?? 0),
      firstDisclosureDate: (row as { first_disclosure_date: string | null }).first_disclosure_date,
      lastDisclosureDate: (row as { last_disclosure_date: string | null }).last_disclosure_date,
      samplePoliticians: ((row as { sample_politicians: string[] | null }).sample_politicians ?? []).filter(Boolean),
      sampleAssetNames,
      importFailureReason: importFailure?.reason ?? null,
      importFailureDetail: importFailure?.detail ?? null,
      classification,
      classificationReason,
    };
  });

  const grouped = Object.fromEntries(
    GROUP_ORDER.map((classification) => [
      classification,
      rows
        .filter((row) => row.classification === classification)
        .sort((a, b) => b.disclosureCount - a.disclosureCount),
    ])
  ) as Record<MissingPriceClassification, ReportRow[]>;

  const summary = Object.fromEntries(
    GROUP_ORDER.map((classification) => [classification, grouped[classification].length])
  ) as Record<MissingPriceClassification, number>;

  const output = {
    generatedAt: new Date().toISOString(),
    summary,
    groups: GROUP_ORDER.map((classification) => ({
      classification,
      count: grouped[classification].length,
      rows: grouped[classification],
    })),
  };

  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/missing-price-review.json", JSON.stringify(output, null, 2));

  console.log("Missing price ticker review summary:");
  for (const classification of GROUP_ORDER) {
    console.log(`- ${classification}: ${summary[classification]}`);
  }

  for (const classification of GROUP_ORDER) {
    const groupRows = grouped[classification];
    if (groupRows.length === 0) continue;

    console.log(`\n[${classification}] (${groupRows.length})`);
    for (const row of groupRows) {
      console.log(
        [
          `rawTicker=${row.rawTicker}`,
          `storageTicker=${row.storageTicker}`,
          `yahooLookupTicker=${row.yahooLookupTicker}`,
          `disclosureCount=${row.disclosureCount}`,
          `firstDisclosureDate=${row.firstDisclosureDate ?? "n/a"}`,
          `lastDisclosureDate=${row.lastDisclosureDate ?? "n/a"}`,
          `samplePoliticians=${row.samplePoliticians.join(" | ") || "n/a"}`,
          `sampleAssetNames=${row.sampleAssetNames.join(" | ") || "n/a"}`,
          `importFailureReason=${row.importFailureReason ?? "n/a"}`,
          `importFailureDetail=${row.importFailureDetail ?? "n/a"}`,
          `classificationReason=${row.classificationReason}`,
        ].join(" ; ")
      );
    }
  }

  console.log("\nWrote JSON report: tmp/missing-price-review.json");
}

main().catch((error) => {
  console.error("Failed to generate missing price ticker review:", error);
  process.exit(1);
});
