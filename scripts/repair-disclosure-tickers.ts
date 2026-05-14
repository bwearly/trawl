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

const APPLY_REPAIRS = process.env.APPLY_REPAIRS === "true";

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

async function getAppellPeteCandidatesByTicker(ticker: "APPL" | "AAPL"): Promise<DisclosureCandidate[]> {
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
      and(eq(disclosures.ticker, ticker), ilike(disclosures.assetName, "%Appell Pete%"))
    )
    .orderBy(disclosures.id);
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

  const attCandidates = await getAttCandidates();
  printSampleRows("AT&T AT->T", attCandidates);

  let attUpdated = 0;
  if (APPLY_REPAIRS) {
    attUpdated = await applyAttRepairs();
    console.log(`AT&T updated rows=${attUpdated}`);
  } else {
    console.log("AT&T dry-run only: no updates applied.");
  }

  const appellPeteApplCandidates = await getAppellPeteCandidatesByTicker("APPL");
  const appellPeteAaplCandidates = await getAppellPeteCandidatesByTicker("AAPL");
  printSampleRows("Appell Pete APPL candidates (raw ticker)", appellPeteApplCandidates);
  printSampleRows("Appell Pete AAPL candidates (normalized/storage ticker)", appellPeteAaplCandidates);
  const appellPeteTotal = appellPeteApplCandidates.length + appellPeteAaplCandidates.length;
  console.log(`Appell Pete review status: manual-review candidates=${appellPeteTotal}`);
  if (APPLY_REPAIRS) {
    console.log(
      "Appell Pete apply-mode action: SKIPPED (manual review required; no safe replacement ticker is inferred in this script)."
    );
  } else {
    console.log("Appell Pete dry-run action: MANUAL-REVIEW (candidate rows reported, no DB updates).");
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
