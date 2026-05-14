import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { disclosures } from "../lib/db/schema";
import { normalizeTickerForStorage, normalizeYahooSymbol } from "../lib/domain/pipeline/normalization";

type DisclosureCandidate = {
  id: number;
  ticker: string | null;
  assetName: string;
  sourceLabel: string | null;
  tradeDate: Date | null;
  filingDate: Date | null;
};

type FalsePositiveRule = {
  label: string;
  ticker: string;
  assetName: string;
};

const APPLY_REPAIRS = process.env.APPLY_REPAIRS === "true";

const FALSE_POSITIVE_RULES: FalsePositiveRule[] = [
  { label: "Appell Pete Corp", ticker: "APPL", assetName: "Appell Pete Corp" },
  { label: "Appell Pete Corp", ticker: "AAPL", assetName: "Appell Pete Corp" },
  { label: "Interest", ticker: "FEI", assetName: "Interest" },
  { label: "Issued", ticker: "FNFV.V", assetName: "Issued" },
  { label: "Shares", ticker: "MAG", assetName: "Shares" },
  { label: "NEW", ticker: "NEW", assetName: "NEW" },
];

function formatDate(value: Date | null): string {
  if (!value) return "null";
  return value.toISOString().slice(0, 10);
}

function printSampleRows(label: string, rows: DisclosureCandidate[]): void {
  const sample = rows.slice(0, 5);
  console.log(`\n${label} candidates=${rows.length}`);
  if (sample.length === 0) {
    console.log("  sample: none");
    return;
  }

  for (const row of sample) {
    console.log(
      `  - id=${row.id} ticker=${row.ticker ?? "null"} asset=\"${row.assetName}\" source=${row.sourceLabel ?? "null"} tradeDate=${formatDate(row.tradeDate)} filingDate=${formatDate(row.filingDate)}`
    );
  }
}

async function getAttCandidates(): Promise<DisclosureCandidate[]> {
  return db
    .select({
      id: disclosures.id,
      ticker: disclosures.ticker,
      assetName: disclosures.assetName,
      sourceLabel: disclosures.sourceLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.ticker, "AT"),
        or(
          eq(disclosures.assetName, "AT&T Inc"),
          ilike(disclosures.assetName, "%AT&T Inc%")
        )
      )
    )
    .orderBy(disclosures.id);
}

async function applyAttRepairs(): Promise<number> {
  const result = await db
    .update(disclosures)
    .set({
      ticker: "T",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(disclosures.ticker, "AT"),
        or(
          eq(disclosures.assetName, "AT&T Inc"),
          ilike(disclosures.assetName, "%AT&T Inc%")
        )
      )
    )
    .returning({ id: disclosures.id });

  return result.length;
}

async function getFalsePositiveCandidates(rule: FalsePositiveRule): Promise<DisclosureCandidate[]> {
  return db
    .select({
      id: disclosures.id,
      ticker: disclosures.ticker,
      assetName: disclosures.assetName,
      sourceLabel: disclosures.sourceLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
    })
    .from(disclosures)
    .where(and(eq(disclosures.ticker, rule.ticker), eq(disclosures.assetName, rule.assetName)))
    .orderBy(disclosures.id);
}

async function clearFalsePositiveTickers(rule: FalsePositiveRule): Promise<number> {
  const result = await db
    .update(disclosures)
    .set({
      ticker: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(disclosures.ticker, rule.ticker), eq(disclosures.assetName, rule.assetName)))
    .returning({ id: disclosures.id });

  return result.length;
}

async function getFiservDiagnostics(): Promise<DisclosureCandidate[]> {
  return db
    .select({
      id: disclosures.id,
      ticker: disclosures.ticker,
      assetName: disclosures.assetName,
      sourceLabel: disclosures.sourceLabel,
      tradeDate: disclosures.tradeDate,
      filingDate: disclosures.filingDate,
    })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.ticker, "FI"),
        or(eq(disclosures.assetName, "Fiserv, Inc"), ilike(disclosures.assetName, "%Fiserv, Inc%"))
      )
    )
    .orderBy(disclosures.id);
}

async function main(): Promise<void> {
  console.log(`Disclosure ticker repair mode: ${APPLY_REPAIRS ? "APPLY" : "DRY RUN"}`);
  console.log(
    `Normalization diagnostics: storage(FISV)->${normalizeTickerForStorage("FISV")}, yahoo(FI)->${normalizeYahooSymbol("FI")}`
  );
  console.log(
    "Schema safety check: disclosures.ticker is nullable, and downstream scripts skip/process null tickers safely where required."
  );

  const attCandidates = await getAttCandidates();
  printSampleRows("AT&T AT->T", attCandidates);

  let attUpdated = 0;
  if (APPLY_REPAIRS) {
    attUpdated = await applyAttRepairs();
    console.log(`AT&T updated rows=${attUpdated}`);
  } else {
    console.log("AT&T dry-run only: no updates applied.");
  }

  let totalFalsePositiveCandidates = 0;
  let totalFalsePositiveUpdates = 0;

  for (const rule of FALSE_POSITIVE_RULES) {
    const candidates = await getFalsePositiveCandidates(rule);
    totalFalsePositiveCandidates += candidates.length;
    printSampleRows(`False-positive parser-noise ${rule.ticker} / ${rule.assetName}`, candidates);

    if (APPLY_REPAIRS) {
      const updated = await clearFalsePositiveTickers(rule);
      totalFalsePositiveUpdates += updated;
      console.log(`Applied parser-noise cleanup for ${rule.ticker}/${rule.assetName}: updated=${updated}`);
    }
  }

  console.log(`False-positive parser-noise total candidates=${totalFalsePositiveCandidates}`);
  if (APPLY_REPAIRS) {
    console.log(`False-positive parser-noise total updated=${totalFalsePositiveUpdates}`);
    console.log("Apply mode: parser-noise false positives were cleared by setting ticker=null for exact-match rules only.");
  } else {
    console.log("Dry-run mode: no parser-noise updates applied. Set APPLY_REPAIRS=true to apply exact-match null ticker cleanup.");
  }

  const fiservCandidates = await getFiservDiagnostics();
  printSampleRows("Fiserv FI diagnostics", fiservCandidates);
  console.log(
    "Fiserv action: report-only. Existing normalization maps storage FISV->FI and Yahoo FI->FISV, so no DB ticker update is applied by this script."
  );

  console.log("\nRepair script completed successfully.");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Repair script failed.", error);
    process.exit(1);
  });
