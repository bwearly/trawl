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
  start?: string;
  end?: string;
};

type LegislatorRecord = {
  name?: LegislatorName;
  terms?: LegislatorTerm[];
};

type SupportedChamber = "house" | "senate";

type MetadataMatch = {
  state: string | null;
  party: string | null;
  canonicalName: string;
  termType: "rep" | "sen";
  termStart: string | null;
  termEnd: string | null;
};

type ChamberAwareAliasRule = {
  chamber: SupportedChamber;
  aliasTarget?: string;
  canonicalIncludes?: string;
  expectedState?: string;
  expectedTermType: "rep" | "sen";
};

type FinalOverrideRule = {
  chamber: SupportedChamber;
  politicianId?: number;
  canonicalName?: string;
  canonicalIncludes?: string;
  canonicalNamesAny?: string[];
  state?: string;
  termType: "rep" | "sen";
  party?: string;
};

const CHAMBER_AWARE_ALIAS_RULES: Record<string, ChamberAwareAliasRule> = {
  "house|JAMES E HON BANKS": { chamber: "house", aliasTarget: "JIM BANKS", expectedState: "IN", expectedTermType: "rep" },
  "house|RICHARD DEAN DR MCCORMICK": { chamber: "house", aliasTarget: "RICH MCCORMICK", expectedState: "GA", expectedTermType: "rep" },
  "house|JOHN MCGUIRE": { chamber: "house", aliasTarget: "JOHN J MCGUIRE", expectedState: "VA", expectedTermType: "rep" },
  "house|MARK DR GREEN": { chamber: "house", aliasTarget: "MARK E GREEN", expectedState: "TN", expectedTermType: "rep" },
  "senate|JAMES BANKS": { chamber: "senate", aliasTarget: "JIM BANKS", expectedState: "IN", expectedTermType: "sen" },
};

const FINAL_EXPLICIT_OVERRIDES: Record<string, FinalOverrideRule> = {
  "house|JAMES E BANKS": {
    chamber: "house",
    canonicalName: "Jim Banks",
    canonicalNamesAny: ["Jim Banks", "James E. Banks"],
    state: "IN",
    termType: "rep",
    party: "Republican",
  },
  "house|RICHARD DEAN MCCORMICK": {
    chamber: "house",
    canonicalName: "Richard McCormick",
    state: "GA",
    termType: "rep",
    party: "Republican",
  },
  "house|RICHARD DEAN DR MCCORMICK": {
    chamber: "house",
    politicianId: 52,
    canonicalName: "Richard McCormick",
    state: "GA",
    termType: "rep",
    party: "Republican",
  },
  "house|MARK GREEN": {
    chamber: "house",
    canonicalName: "Mark E. Green",
    state: "TN",
    termType: "rep",
    party: "Republican",
  },
  "house|MARK DR GREEN": {
    chamber: "house",
    politicianId: 95,
    canonicalName: "Mark E. Green",
    state: "TN",
    termType: "rep",
    party: "Republican",
  },
};

const NAME_ALIASES: Record<string, string> = {
  "DONALD STERNOFF BEYER": "DONALD S BEYER",
  "NEAL PATRICK DUNN": "NEAL P DUNN",
  "RICHARD DEAN MCCORMICK": "RICHARD MCCORMICK",
  "JAMES FRENCH HILL": "J FRENCH HILL",
  "JAMES D JORDAN": "JIM JORDAN",
  "JAMES E BANKS": "JIM BANKS",
  "JAMES E HON BANKS": "JIM BANKS",
  "EARL LEROY CARTER": "EARL L CARTER",
  "CAROL DEVINE MILLER": "CAROL D MILLER",
  "PETER ALLEN STAUBER": "PETE STAUBER",
  "ELIZABETH FLETCHER": "LIZZIE FLETCHER",
  "RICHARD W ALLEN": "RICK W ALLEN",
  "ROB BRESNAHAN": "ROBERT P BRESNAHAN",
  "SCOTT SCOTT FRANKLIN": "C SCOTT FRANKLIN",
  "MICHAEL PATRICK GUEST": "MICHAEL GUEST",
  "RICHARD DEAN DR MCCORMICK": "RICH MCCORMICK",
  "RICHARD MCCORMICK": "RICH MCCORMICK",
  "JOHN MCGUIRE": "JOHN J MCGUIRE",
  "GREG STEUBE": "W GREGORY STEUBE",
  "MARK DR GREEN": "MARK E GREEN",
  "MARK GREEN": "MARK E GREEN",
  "SHELLEY CAPITO": "SHELLEY MOORE CAPITO",
  "JOHN BOOZMAN": "JOHN BOOZMAN",
  "JOHN FETTERMAN": "JOHN FETTERMAN",
  "JAMES BANKS": "JIM BANKS",
  "MICHAEL A COLLINS": "MIKE COLLINS",
  "RUDY C YAKYM": "RUDY YAKYM",
  "LLOYD K SMUCKER": "LLOYD SMUCKER",
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

function getMatchesForPoliticianName(
  metadataIndex: Map<string, MetadataMatch[]>,
  fullName: string
): { matches: MetadataMatch[]; matchedByAlias: boolean } {
  const normalized = normalizeName(fullName);
  const aliasTarget = NAME_ALIASES[normalized];
  const keys = aliasTarget ? [normalized, aliasTarget] : [normalized];
  const all = keys.flatMap((key) => metadataIndex.get(key) ?? []);
  return { matches: dedupeMatches(all), matchedByAlias: Boolean(aliasTarget) };
}


function getRuleScopedMatches(
  metadataIndex: Map<string, MetadataMatch[]>,
  politician: PoliticianRow & { chamber: SupportedChamber },
  inputMatches: MetadataMatch[]
): { matches: MetadataMatch[]; matchedByRule: boolean } {
  const normalized = normalizeName(politician.fullName);
  const rule = CHAMBER_AWARE_ALIAS_RULES[`${politician.chamber}|${normalized}`];
  if (!rule) return { matches: inputMatches, matchedByRule: false };

  let scoped = inputMatches.filter((m) => m.termType === rule.expectedTermType);
  if (rule.aliasTarget) {
    const aliasCandidates = metadataIndex.get(rule.aliasTarget) ?? [];
    const allowedCanonicalNames = new Set(aliasCandidates.map((c) => c.canonicalName));
    if (allowedCanonicalNames.size > 0) scoped = scoped.filter((m) => allowedCanonicalNames.has(m.canonicalName));
  }
  if (rule.canonicalIncludes) {
    const needle = rule.canonicalIncludes.toUpperCase();
    scoped = scoped.filter((m) => m.canonicalName.toUpperCase().includes(needle));
  }
  if (rule.expectedState) {
    scoped = scoped.filter((m) => normalizeState(m.state) === rule.expectedState);
  }
  return { matches: dedupeMatches(scoped), matchedByRule: true };
}

function getFinalOverride(politician: PoliticianRow & { chamber: SupportedChamber }): FinalOverrideRule | null {
  const normalized = normalizeName(politician.fullName);
  const rule = FINAL_EXPLICIT_OVERRIDES[`${politician.chamber}|${normalized}`];
  if (!rule) return null;
  if (rule.politicianId !== undefined && rule.politicianId !== politician.id) return null;
  return rule;
}

function applyFinalOverride(
  matches: MetadataMatch[],
  override: FinalOverrideRule | null
 ): { matches: MetadataMatch[]; overrideKeyChecked: string | null; usedFallback: boolean } {
  if (!override) return { matches, overrideKeyChecked: null, usedFallback: false };
  const canonicalNeedle = override.canonicalName?.toUpperCase();
  const canonicalIncludesNeedle = override.canonicalIncludes?.toUpperCase();
  const canonicalNamesAny = (override.canonicalNamesAny ?? []).map((name) => normalizeName(name));
  const stateNeedle = override.state ? normalizeState(override.state) : null;
  const partyNeedle = override.party ? normalizeParty(override.party) : null;

  const primaryMatches = dedupeMatches(
    matches.filter((match) => {
      if (match.termType !== override.termType) return false;
      if (canonicalNeedle && !match.canonicalName.toUpperCase().includes(canonicalNeedle)) return false;
      if (canonicalNamesAny.length > 0 && !canonicalNamesAny.includes(normalizeName(match.canonicalName))) return false;
      if (stateNeedle && normalizeState(match.state) !== stateNeedle) return false;
      if (partyNeedle && normalizeParty(match.party) !== partyNeedle) return false;
      return true;
    })
  );

  if (primaryMatches.length > 0) return { matches: primaryMatches, overrideKeyChecked: canonicalNeedle, usedFallback: false };
  if (!canonicalIncludesNeedle) return { matches: primaryMatches, overrideKeyChecked: canonicalNeedle, usedFallback: false };

  const fallbackMatches = dedupeMatches(
    matches.filter((match) => {
      if (match.termType !== override.termType) return false;
      if (stateNeedle && normalizeState(match.state) !== stateNeedle) return false;
      if (partyNeedle && normalizeParty(match.party) !== partyNeedle) return false;
      return match.canonicalName.toUpperCase().includes(canonicalIncludesNeedle);
    })
  );

  return { matches: fallbackMatches, overrideKeyChecked: canonicalIncludesNeedle, usedFallback: true };
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
    const termType = latestTerm?.type === "sen" ? "sen" : "rep";
    const party = normalizeParty(latestTerm?.party);
    const state = normalizeState(latestTerm?.state);
    const termStart = latestTerm?.start?.trim() ? latestTerm.start.trim() : null;
    const termEnd = latestTerm?.end?.trim() ? latestTerm.end.trim() : null;
    const canonicalName = (record.name.official_full ?? buildNameVariants(record.name)[0] ?? "").trim();
    if (!canonicalName) continue;

    for (const variant of buildNameVariants(record.name)) {
      const key = normalizeName(variant);
      if (!key) continue;
      const existing = index.get(key) ?? [];
      existing.push({ party, state, canonicalName, termType, termStart, termEnd });
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

  const allPoliticians: PoliticianRow[] = await db
    .select({
      id: politicians.id,
      fullName: politicians.fullName,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
    })
    .from(politicians);

  const scopedPoliticians = allPoliticians.filter(
    (politician): politician is PoliticianRow & { chamber: SupportedChamber } =>
      politician.chamber === "house" || politician.chamber === "senate"
  );

  const unmatched: Array<{ id: number; fullName: string; reason: string; candidates?: MetadataMatch[] }> = [];
  let updated = 0;
  let matched = 0;
  let skippedExisting = 0;
  let noChange = 0;
  let updatedPartyCount = 0;
  let updatedStateCount = 0;
  let matchedByAliasCount = 0;
  let matchedByStateDisambiguationCount = 0;
  let matchedByExactCount = 0;
  let matchedByChamberCount = 0;
  let matchedByFinalOverrideCount = 0;

  const houseScannedCount = scopedPoliticians.filter((p) => p.chamber === "house").length;
  const senateScannedCount = scopedPoliticians.filter((p) => p.chamber === "senate").length;
  let matchedHouseCount = 0;
  let matchedSenateCount = 0;

  console.log(`Politicians loaded: ${scopedPoliticians.length}`);

  for (const politician of scopedPoliticians) {
    const expectedTermType = politician.chamber === "house" ? "rep" : "sen";
    const { matches: allMatches, matchedByAlias } = getMatchesForPoliticianName(metadataIndex, politician.fullName);
    const chamberMatches = allMatches.filter((match) => match.termType === expectedTermType);
    const { matches: ruleMatches, matchedByRule } = getRuleScopedMatches(metadataIndex, politician, chamberMatches);
    const normalizedName = normalizeName(politician.fullName);
    const finalOverride = getFinalOverride(politician);
    const { matches } = applyFinalOverride(ruleMatches, finalOverride);

    if (matches.length === 0) {
      unmatched.push({ id: politician.id, fullName: politician.fullName, reason: "no_match" });
      continue;
    }
    if (matchedByAlias || matchedByRule) matchedByAliasCount += 1;
    if (finalOverride && matches.length > 0) matchedByFinalOverrideCount += 1;

    if (matches.length > 1) {
      if (finalOverride && (finalOverride.canonicalName || finalOverride.state)) {
        const recentSorted = [...matches].sort((a, b) => (b.termStart ?? "").localeCompare(a.termStart ?? ""));
        const mostRecent = recentSorted[0];
        if (mostRecent) {
          matched += 1;
          if (politician.chamber === "house") matchedHouseCount += 1;
          if (politician.chamber === "senate") matchedSenateCount += 1;
          const shouldSkipParty = !force && politician.party !== null;
          const shouldSkipState = !force && politician.state !== null;
          if (shouldSkipParty && shouldSkipState) {
            skippedExisting += 1;
            continue;
          }
          const nextParty = force || politician.party === null ? (mostRecent.party ?? politician.party) : politician.party;
          const nextState = force || politician.state === null ? (mostRecent.state ?? politician.state) : politician.state;

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
            .where(and(eq(politicians.id, politician.id), eq(politicians.chamber, politician.chamber)));

          if (nextParty !== politician.party) updatedPartyCount += 1;
          if (nextState !== politician.state) updatedStateCount += 1;
          updated += 1;
          console.log(
            `✅ Updated ${politician.fullName}: party ${politician.party ?? "NULL"} -> ${nextParty ?? "NULL"}, state ${politician.state ?? "NULL"} -> ${nextState ?? "NULL"}`
          );
          if (normalizedName === "JAMES E BANKS" || normalizedName === "JAMES E HON BANKS") {
            console.log("Final override selected: James E Hon Banks -> Jim Banks, IN, Republican, rep");
          }
          continue;
        }
      }
      const politicianState = normalizeState(politician.state);
      const stateScopedMatches = politicianState
        ? matches.filter((candidate) => normalizeState(candidate.state) === politicianState)
        : [];
      if (stateScopedMatches.length === 1) {
        matchedByStateDisambiguationCount += 1;
        matched += 1;
        if (politician.chamber === "house") matchedHouseCount += 1;
        if (politician.chamber === "senate") matchedSenateCount += 1;
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
          .where(and(eq(politicians.id, politician.id), eq(politicians.chamber, politician.chamber)));

        if (nextParty !== politician.party) updatedPartyCount += 1;
        if (nextState !== politician.state) updatedStateCount += 1;
        updated += 1;
        console.log(
          `✅ Updated ${politician.fullName}: party ${politician.party ?? "NULL"} -> ${nextParty ?? "NULL"}, state ${politician.state ?? "NULL"} -> ${nextState ?? "NULL"}`
        );
        continue;
      }
      unmatched.push({ id: politician.id, fullName: politician.fullName, reason: "ambiguous_match", candidates: matches });
      console.log(`⚠️ Ambiguous metadata match for fullName="${politician.fullName}" chamber="${politician.chamber}" reason="ambiguous_match" (${matches.length} candidates).`);
      for (const candidate of matches) {
        console.log(
          `   - fullName=${politician.fullName} chamber=${politician.chamber} reason=ambiguous_match candidate=${candidate.canonicalName} state=${candidate.state ?? "NULL"} party=${candidate.party ?? "NULL"} termType=${candidate.termType} term=${candidate.termStart ?? "?"}..${candidate.termEnd ?? "present"}`
        );
      }
      continue;
    }

    if (allMatches.length > chamberMatches.length) matchedByChamberCount += 1;
    else if (matchedByAlias) {
      // accounted above; retained for summary clarity
    } else {
      matchedByExactCount += 1;
    }

    matched += 1;
    if (politician.chamber === "house") matchedHouseCount += 1;
    if (politician.chamber === "senate") matchedSenateCount += 1;
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
      .where(and(eq(politicians.id, politician.id), eq(politicians.chamber, politician.chamber)));

    if (nextParty !== politician.party) updatedPartyCount += 1;
    if (nextState !== politician.state) updatedStateCount += 1;
    updated += 1;
    console.log(
      `✅ Updated ${politician.fullName}: party ${politician.party ?? "NULL"} -> ${nextParty ?? "NULL"}, state ${politician.state ?? "NULL"} -> ${nextState ?? "NULL"}`
    );
  }

  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/unmatched-politician-metadata.json", JSON.stringify(unmatched, null, 2), "utf8");
  const unmatchedNoMatchCount = unmatched.filter((entry) => entry.reason === "no_match").length;
  const unmatchedAmbiguousCount = unmatched.filter((entry) => entry.reason === "ambiguous_match").length;

  console.log("Backfill complete.");
  console.log(`- House politicians scanned: ${houseScannedCount}`);
  console.log(`- Senate politicians scanned: ${senateScannedCount}`);
  console.log(`- Metadata records loaded: ${metadataRecordsLoaded}`);
  console.log(`- Matched House: ${matchedHouseCount}`);
  console.log(`- Matched Senate: ${matchedSenateCount}`);
  console.log(`- Matched total: ${matched}`);
  console.log(`- Updated: ${updated}`);
  console.log(`- Updated party count: ${updatedPartyCount}`);
  console.log(`- Updated state count: ${updatedStateCount}`);
  console.log(`- Matched by alias: ${matchedByAliasCount}`);
  console.log(`- Matched by exact: ${matchedByExactCount}`);
  console.log(`- Matched by chamber: ${matchedByChamberCount}`);
  console.log(`- Matched by final override: ${matchedByFinalOverrideCount}`);
  console.log(`- Matched by state disambiguation: ${matchedByStateDisambiguationCount}`);
  console.log(`- Skipped existing: ${skippedExisting}`);
  console.log(`- Unchanged: ${noChange}`);
  console.log(`- Remaining unmatched: ${unmatchedNoMatchCount}`);
  console.log(`- Remaining ambiguous: ${unmatchedAmbiguousCount}`);
  console.log(`- Unmatched total: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log("- Unmatched list:");
    for (const entry of unmatched) {
      console.log(`  - [${entry.reason}] ${entry.fullName}`);
    }
  }
  console.log(`- Unmatched output: tmp/unmatched-politician-metadata.json`);
}

backfillPoliticianMetadata().catch((error) => {
  console.error("Failed to backfill politician metadata:", error);
  process.exit(1);
});
