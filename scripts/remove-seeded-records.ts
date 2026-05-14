import "dotenv/config";
import { and, count, eq, inArray, like, notInArray, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  alerts,
  disclosurePerformanceWindows,
  disclosures,
  politicianStats,
  politicians,
  researchSignals,
} from "../lib/db/schema";

const SEEDED_SOURCE_URL_PREFIX = "https://example.com/filing/%";
const SEEDED_POLITICIAN_NAMES = [
  "Nancy Pelosi",
  "Dan Crenshaw",
  "Tommy Tuberville",
  "Ron Wyden",
  "Angus King",
] as const;

async function main() {
  const apply = process.env.APPLY_REMOVE_SEED === "true";
  console.log(`🧪 Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const seededDisclosures = await db
    .select({
      id: disclosures.id,
      politicianId: disclosures.politicianId,
      ticker: disclosures.ticker,
      sourceUrl: disclosures.sourceUrl,
    })
    .from(disclosures)
    .where(like(disclosures.sourceUrl, SEEDED_SOURCE_URL_PREFIX));

  const seededDisclosureIds = seededDisclosures.map((d) => d.id);
  const seededDisclosurePoliticianIds = [
    ...new Set(seededDisclosures.map((d) => d.politicianId)),
  ];

  const seededSignals = seededDisclosureIds.length
    ? await db
        .select({ id: researchSignals.id, disclosureId: researchSignals.disclosureId })
        .from(researchSignals)
        .where(inArray(researchSignals.disclosureId, seededDisclosureIds))
    : [];
  const seededSignalIds = seededSignals.map((s) => s.id);

  const seededPerformanceWindows = seededDisclosureIds.length
    ? await db
        .select({ id: disclosurePerformanceWindows.id })
        .from(disclosurePerformanceWindows)
        .where(inArray(disclosurePerformanceWindows.disclosureId, seededDisclosureIds))
    : [];

  const candidateAlerts = seededDisclosureIds.length || seededSignalIds.length
    ? await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          or(
            seededDisclosureIds.length
              ? inArray(alerts.disclosureId, seededDisclosureIds)
              : sql`false`,
            seededSignalIds.length
              ? inArray(alerts.researchSignalId, seededSignalIds)
              : sql`false`
          )
        )
    : [];

  const seededPoliticiansByName = await db
    .select({ id: politicians.id, fullName: politicians.fullName })
    .from(politicians)
    .where(inArray(politicians.fullName, [...SEEDED_POLITICIAN_NAMES]));

  const seededCandidatePoliticianIds = [
    ...new Set([
      ...seededDisclosurePoliticianIds,
      ...seededPoliticiansByName.map((p) => p.id),
    ]),
  ];

  const orphanedSeededPoliticianIds: number[] = [];
  for (const politicianId of seededCandidatePoliticianIds) {
    const [remainingNonSeed] = await db
      .select({ count: count() })
      .from(disclosures)
      .where(
        and(
          eq(disclosures.politicianId, politicianId),
          notInArray(disclosures.id, seededDisclosureIds.length ? seededDisclosureIds : [-1])
        )
      );

    if ((remainingNonSeed?.count ?? 0) === 0) {
      orphanedSeededPoliticianIds.push(politicianId);
    }
  }

  const orphanedSeededPoliticians = seededPoliticiansByName.filter((p) =>
    orphanedSeededPoliticianIds.includes(p.id)
  );

  const candidatePoliticianStats = orphanedSeededPoliticianIds.length
    ? await db
        .select({ id: politicianStats.id, politicianId: politicianStats.politicianId })
        .from(politicianStats)
        .where(inArray(politicianStats.politicianId, orphanedSeededPoliticianIds))
    : [];

  console.log("\n📊 Candidate counts:");
  console.log(`- disclosures: ${seededDisclosures.length}`);
  console.log(`- researchSignals: ${seededSignals.length}`);
  console.log(`- disclosurePerformanceWindows: ${seededPerformanceWindows.length}`);
  console.log(`- alerts (linked to seeded disclosure/signal): ${candidateAlerts.length}`);
  console.log(`- politicianStats (orphaned seeded politicians only): ${candidatePoliticianStats.length}`);
  console.log(`- politicians (orphaned seeded politicians only): ${orphanedSeededPoliticians.length}`);

  console.log("\n🔎 Sample seeded disclosures:");
  for (const row of seededDisclosures.slice(0, 10)) {
    console.log(`- id=${row.id} ticker=${row.ticker ?? "null"} sourceUrl=${row.sourceUrl ?? "null"}`);
  }

  if (!apply) {
    console.log("\n✅ DRY RUN complete. No records were deleted.");
    return;
  }

  console.log(
    "\n⚠️ APPLY mode uses sequential deletes because Neon HTTP does not support transactions."
  );

  async function runDelete(label: string, executeDelete: () => Promise<number>) {
    try {
      const deletedCount = await executeDelete();
      console.log(`- deleted ${label}: ${deletedCount}`);
    } catch (error) {
      console.error(`❌ Failed while deleting ${label}.`);
      console.error(
        "Fix the issue, then rerun `npm run db:remove-seed` to continue cleanup from this point."
      );
      throw error;
    }
  }

  await runDelete("alerts", async () => {
    if (!candidateAlerts.length) return 0;
    const deleted = await db
      .delete(alerts)
      .where(inArray(alerts.id, candidateAlerts.map((a) => a.id)))
      .returning({ id: alerts.id });
    return deleted.length;
  });

  await runDelete("researchSignals", async () => {
    if (!seededSignalIds.length) return 0;
    const deleted = await db
      .delete(researchSignals)
      .where(inArray(researchSignals.id, seededSignalIds))
      .returning({ id: researchSignals.id });
    return deleted.length;
  });

  await runDelete("disclosurePerformanceWindows", async () => {
    if (!seededPerformanceWindows.length) return 0;
    const deleted = await db
      .delete(disclosurePerformanceWindows)
      .where(inArray(disclosurePerformanceWindows.id, seededPerformanceWindows.map((p) => p.id)))
      .returning({ id: disclosurePerformanceWindows.id });
    return deleted.length;
  });

  await runDelete("disclosures", async () => {
    if (!seededDisclosureIds.length) return 0;
    const deleted = await db
      .delete(disclosures)
      .where(inArray(disclosures.id, seededDisclosureIds))
      .returning({ id: disclosures.id });
    return deleted.length;
  });

  await runDelete("politicianStats", async () => {
    if (!candidatePoliticianStats.length) return 0;
    const deleted = await db
      .delete(politicianStats)
      .where(inArray(politicianStats.id, candidatePoliticianStats.map((p) => p.id)))
      .returning({ id: politicianStats.id });
    return deleted.length;
  });

  await runDelete("politicians", async () => {
    if (!orphanedSeededPoliticians.length) return 0;
    const deleted = await db
      .delete(politicians)
      .where(inArray(politicians.id, orphanedSeededPoliticianIds))
      .returning({ id: politicians.id });
    return deleted.length;
  });

  console.log("\n🗑️ APPLY complete. Seeded/demo-linked records were deleted safely.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ remove-seeded-records failed", error);
    process.exit(1);
  });
