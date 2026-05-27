import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { politicians } from "../lib/db/schema";

type Chamber = "house" | "senate";

type LegislatorTerm = {
  type?: "rep" | "sen";
  state?: string;
  district?: number;
  party?: string;
  end?: string;
  start?: string;
  url?: string;
};

type LegislatorRecord = {
  id?: { bioguide?: string };
  name?: {
    first?: string;
    middle?: string;
    last?: string;
    suffix?: string;
    official_full?: string;
  };
  terms?: LegislatorTerm[];
};

const CURRENT_LEGISLATORS_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-current.json";
const SOURCE_LABEL = "unitedstates/congress-legislators (public domain)";
const DRY_RUN = String(process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

function formatName(record: LegislatorRecord): string {
  const official = record.name?.official_full?.trim();
  if (official) return official;
  return [record.name?.first, record.name?.middle, record.name?.last, record.name?.suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeParty(raw: string | undefined): string | null {
  if (!raw) return null;
  const p = raw.toLowerCase();
  if (p.includes("democrat")) return "Democrat";
  if (p.includes("republican")) return "Republican";
  if (p.includes("independent")) return "Independent";
  return raw;
}

function getCurrentTerm(terms: LegislatorTerm[]): LegislatorTerm | null {
  const now = new Date();
  const sorted = [...terms].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const active = sorted.filter((term) => {
    if (!term.end) return true;
    return new Date(`${term.end}T23:59:59Z`) >= now;
  });
  return active.at(-1) ?? sorted.at(-1) ?? null;
}

async function main() {
  console.log(`🏛️ Importing current Congress roster (dry run: ${DRY_RUN})`);
  const response = await fetch(CURRENT_LEGISLATORS_URL);
  if (!response.ok) throw new Error(`Failed to fetch roster: ${response.status}`);
  const raw = (await response.json()) as LegislatorRecord[];

  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  for (const member of raw) {
    const term = getCurrentTerm(member.terms ?? []);
    if (!term || (term.type !== "rep" && term.type !== "sen")) continue;

    const fullName = formatName(member);
    if (!fullName) continue;

    const chamber: Chamber = term.type === "rep" ? "house" : "senate";
    const state = term.state ?? null;
    const district = chamber === "house" && term.district != null ? String(term.district) : null;
    const bioguideId = member.id?.bioguide ?? null;

    const existingByBioguide = bioguideId
      ? await db
          .select({ id: politicians.id })
          .from(politicians)
          .where(eq(politicians.bioguideId, bioguideId))
          .limit(1)
      : [];

    const existingByName =
      existingByBioguide[0] ??
      (await db
        .select({ id: politicians.id })
        .from(politicians)
        .where(
          and(
            eq(politicians.fullName, fullName),
            eq(politicians.chamber, chamber),
            state ? eq(politicians.state, state) : isNull(politicians.state)
          )
        )
        .limit(1))[0];

    const payload = {
      fullName,
      chamber,
      party: normalizeParty(term.party),
      state,
      district,
      officialWebsite: term.url ?? null,
      imageUrl: bioguideId ? `https://bioguideretro.congress.gov/Static_Files/data/photos/${bioguideId[0]}/${bioguideId}.jpg` : null,
      dataSource: SOURCE_LABEL,
      isActive: true,
      bioguideId,
    };

    if (!existingByName) {
      inserted += 1;
      if (!DRY_RUN) await db.insert(politicians).values(payload);
      continue;
    }

    updated += 1;
    if (!DRY_RUN) {
      await db.update(politicians).set(payload).where(eq(politicians.id, existingByName.id));
    }
  }

  const total = inserted + updated + skipped;
  console.log(`✅ Roster processed: ${total} rows`);
  console.log(`➕ Inserted: ${inserted}`);
  console.log(`♻️ Updated: ${updated}`);
  console.log(`⏭️ Skipped: ${skipped}`);
}

main().catch((error) => {
  console.error("❌ import-current-congress-roster failed", error);
  process.exit(1);
});
