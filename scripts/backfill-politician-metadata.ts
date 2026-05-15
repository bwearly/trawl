import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { politicians } from "../lib/db/schema";

type PoliticianRow = {
  id: number;
  fullName: string;
  chamber: string;
  party: string | null;
  state: string | null;
};

type LegislatorName = {
  official_full?: string;
  first?: string;
  middle?: string;
  last?: string;
  suffix?: string;
  nickname?: string;
};

type LegislatorTerm = {
  type?: string;
  party?: string;
  state?: string;
};

type LegislatorRecord = {
  name?: LegislatorName;
  terms?: LegislatorTerm[];
};

type MetadataMatch = {
  state: string | null;
  party: string | null;
  canonicalName: string;
};

const NAME_ALIASES: Record<string, string> = {
  "DONALD STERNOFF BEYER": "DONALD S BEYER",
  "NEAL PATRICK DUNN": "NEAL P DUNN",
  "RICHARD DEAN MCCORMICK": "RICHARD MCCORMICK",
  "JAMES FRENCH HILL": "J FRENCH HILL",
  "JAMES D JORDAN": "JIM JORDAN",
  "JAMES E BANKS": "JIM BANKS",
  "EARL LEROY CARTER": "EARL L CARTER",
  "CAROL DEVINE MILLER": "CAROL D MILLER",
  "PETER ALLEN STAUBER": "PETE STAUBER",
  "ELIZABETH FLETCHER": "LIZZIE FLETCHER",
};

const CURRENT_LEGISLATORS_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-current.json";
const HISTORICAL_LEGISLATORS_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-historical.json";

function normalizeParty(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("democrat")) return "Democrat";
  if (value.includes("republican")) return "Republican";
  if (value.includes("independent")) return "Independent";
  return null;
}

function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’,-]/g, " ")
    .replace(/&/g, " AND ")
    .replace(/\b(MR|MRS|MS|REP|REPRESENTATIVE|HON|HONORABLE)\b/gi, " ")
    .replace(/\b(DR|DOCTOR|MD|M D|PHD|PH D|DO|DDS|DVM|ESQ|FACS|FACS|CPA)\b/gi, " ")
    .replace(/\b(JR|SR|II|III|IV|V)\b/gi, " ")
    .replace(/\b([A-Z])\b/gi, " $1 ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getMatchesForPoliticianName(metadataIndex: Map<string, MetadataMatch[]>, fullName: string): MetadataMatch[] {
  const normalized = normalizeName(fullName);
  const aliasTarget = NAME_ALIASES[normalized];
  const keys = aliasTarget ? [normalized, aliasTarget] : [normalized];
  const all = keys.flatMap((key) => metadataIndex.get(key) ?? []);
  return dedupeMatches(all);
}

function buildNameVariants(name: LegislatorName): string[] {
  const full = [name.first, name.middle, name.last, name.suffix].filter(Boolean).join(" ").trim();
  const firstLast = [name.first, name.last].filter(Boolean).join(" ").trim();
  const nickLast = [name.nickname, name.last].filter(Boolean).join(" ").trim();
  return [name.official_full ?? "", full, firstLast, nickLast]
    .map((value) => value.trim())
    .filter(Boolean);
}

async function fetchLegislators(url: string): Promise<LegislatorRecord[]> {
  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Fetch attempt ${attempt}/${maxAttempts} failed for ${url} with HTTP ${response.status}.`);
        lastError = new Error(`Failed to fetch metadata from ${url}: HTTP ${response.status}`);
      } else {
        const parsed = (await response.json()) as LegislatorRecord[] | undefined;
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Fetch attempt ${attempt}/${maxAttempts} failed for ${url}: ${message}`);
      lastError = error instanceof Error ? error : new Error(message);
    }
  }

  throw lastError ?? new Error(`Failed to fetch metadata from ${url}: unknown error`);
}

function buildMetadataIndex(records: LegislatorRecord[]): Map<string, MetadataMatch[]> {
  const index = new Map<string, MetadataMatch[]>();

  for (const record of records) {
    const terms = record.terms ?? [];
    const congressionalTerms = terms.filter((term) => term.type === "rep" || term.type === "sen");
    if (congressionalTerms.length === 0 || !record.name) continue;
    const latestTerm = congressionalTerms[congressionalTerms.length - 1];
    const party = normalizeParty(latestTerm?.party);
    const state = normalizeState(latestTerm?.state);
    const canonicalName = (record.name.official_full ?? buildNameVariants(record.name)[0] ?? "").trim();
    if (!canonicalName) continue;

    for (const variant of buildNameVariants(record.name)) {
      const key = normalizeName(variant);
      if (!key) continue;
      const existing = index.get(key) ?? [];
      existing.push({ party, state, canonicalName });
      index.set(key, existing);
    }
  }

  return index;
}

function dedupeMatches(matches: MetadataMatch[]): MetadataMatch[] {
  const out = new Map<string, MetadataMatch>();
  for (const match of matches) {
    const key = `${match.canonicalName}|${match.party ?? ""}|${match.state ?? ""}`;
    out.set(key, match);
  }
  return [...out.values()];
}

async function backfillPoliticianMetadata() {
  const force = process.argv.includes("--force");
  console.log(`Backfilling politician metadata (force=${force ? "true" : "false"})...`);
  console.log(`Metadata source: ${CURRENT_LEGISLATORS_URL}`);
  console.log(`Metadata source: ${HISTORICAL_LEGISLATORS_URL}`);

  const [current, historical] = await Promise.all([
    fetchLegislators(CURRENT_LEGISLATORS_URL),
    fetchLegislators(HISTORICAL_LEGISLATORS_URL),
  ]);
  const metadataIndex = buildMetadataIndex([...current, ...historical]);
  const metadataRecordsLoaded = current.length + historical.length;
  console.log(`Metadata records loaded: ${metadataRecordsLoaded}`);
  console.log(`Loaded metadata entries: ${metadataIndex.size} normalized name keys.`);

  const housePoliticians: PoliticianRow[] = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
    })
    .from(politicians)
    .where(eq(politicians.chamber, "house"));

  const unmatched: Array<{ id: number; fullName: string; reason: string; candidates?: MetadataMatch[] }> = [];
  let updated = 0;
  let matched = 0;
  let ambiguous = 0;
  let skippedExisting = 0;
  let noChange = 0;
  let updatedPartyCount = 0;
  let updatedStateCount = 0;

  console.log(`Politicians loaded: ${housePoliticians.length}`);

  for (const politician of housePoliticians) {
    const matches = getMatchesForPoliticianName(metadataIndex, politician.fullName);
    if (matches.length === 0) {
      unmatched.push({ id: politician.id, fullName: politician.fullName, reason: "no_match" });
      continue;
    }
    if (matches.length > 1) {
      const politicianState = normalizeState(politician.state);
      const stateScopedMatches = politicianState
        ? matches.filter((candidate) => normalizeState(candidate.state) === politicianState)
        : [];
      if (stateScopedMatches.length === 1) {
        matched += 1;
        const match = stateScopedMatches[0];
        const shouldSkipParty = !force && politician.party !== null;
        const shouldSkipState = !force && politician.state !== null;
        if (shouldSkipParty && shouldSkipState) {
          skippedExisting += 1;
          continue;
        }
        const nextParty = force || politician.party === null ? (match.party ?? politician.party) : politician.party;
        const nextState = force || politician.state === null ? (match.state ?? politician.state) : politician.state;

        if (nextParty === politician.party && nextState === politician.state) {
          noChange += 1;
          continue;
        }

        await db
          .update(politicians)
          .set({
            party: nextParty,
            state: nextState,
          })
          .where(and(eq(politicians.id, politician.id), eq(politicians.chamber, "house")));

        if (nextParty !== politician.party) updatedPartyCount += 1;
        if (nextState !== politician.state) updatedStateCount += 1;
        updated += 1;
        console.log(
          `✅ Updated ${politician.fullName}: party ${politician.party ?? "NULL"} -> ${nextParty ?? "NULL"}, state ${politician.state ?? "NULL"} -> ${nextState ?? "NULL"}`
        );
        continue;
      }
      ambiguous += 1;
      unmatched.push({ id: politician.id, fullName: politician.fullName, reason: "ambiguous_match", candidates: matches });
      console.log(`⚠️ Ambiguous metadata match for "${politician.fullName}" (${matches.length} candidates).`);
      continue;
    }
    matched += 1;
    const match = matches[0];
    const shouldSkipParty = !force && politician.party !== null;
    const shouldSkipState = !force && politician.state !== null;
    if (shouldSkipParty && shouldSkipState) {
      skippedExisting += 1;
      continue;
    }
    const nextParty = force || politician.party === null ? (match.party ?? politician.party) : politician.party;
    const nextState = force || politician.state === null ? (match.state ?? politician.state) : politician.state;

    if (nextParty === politician.party && nextState === politician.state) {
      noChange += 1;
      continue;
    }

    await db
      .update(politicians)
      .set({
        party: nextParty,
        state: nextState,
      })
      .where(and(eq(politicians.id, politician.id), eq(politicians.chamber, "house")));

    if (nextParty !== politician.party) updatedPartyCount += 1;
    if (nextState !== politician.state) updatedStateCount += 1;
    updated += 1;
    console.log(
      `✅ Updated ${politician.fullName}: party ${politician.party ?? "NULL"} -> ${nextParty ?? "NULL"}, state ${politician.state ?? "NULL"} -> ${nextState ?? "NULL"}`
    );
  }

  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/unmatched-politician-metadata.json", JSON.stringify(unmatched, null, 2), "utf8");

  console.log("Backfill complete.");
  console.log(`- House politicians scanned: ${housePoliticians.length}`);
  console.log(`- Metadata records loaded: ${metadataRecordsLoaded}`);
  console.log(`- Matched (single): ${matched}`);
  console.log(`- Updated: ${updated}`);
  console.log(`- Updated party count: ${updatedPartyCount}`);
  console.log(`- Updated state count: ${updatedStateCount}`);
  console.log(`- Skipped existing: ${skippedExisting}`);
  console.log(`- Unchanged: ${noChange}`);
  console.log(`- Ambiguous: ${ambiguous}`);
  console.log(`- Unmatched total: ${unmatched.length}`);
  console.log(`- Unmatched output: tmp/unmatched-politician-metadata.json`);
}

backfillPoliticianMetadata().catch((error) => {
  console.error("Failed to backfill politician metadata:", error);
  process.exit(1);
});
