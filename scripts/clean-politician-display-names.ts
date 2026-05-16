import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { alerts, disclosures, politicianStats, politicians, researchSignals, watchlistItems } from "../lib/db/schema";
import { normalizePoliticianDisplayName } from "../lib/domain/politicians/normalize-display-name";

async function cleanPoliticianDisplayNames() {
  const rows = await db
    .select({ id: politicians.id, fullName: politicians.fullName, chamber: politicians.chamber })
    .from(politicians)
    .where(eq(politicians.chamber, "house"));

  let cleaned = 0;
  let merged = 0;
  const skippedCollision = 0;

  for (const row of rows) {
    const cleanedName = normalizePoliticianDisplayName(row.fullName);
    if (!cleanedName || cleanedName === row.fullName) continue;

    const collision = await db
      .select({ id: politicians.id })
      .from(politicians)
      .where(and(eq(politicians.fullName, cleanedName), eq(politicians.chamber, row.chamber)))
      .limit(1);

    if (!collision[0]) {
      await db.update(politicians).set({ fullName: cleanedName }).where(eq(politicians.id, row.id));
      cleaned += 1;
      continue;
    }

    const targetId = collision[0].id;
    if (targetId === row.id) continue;

    await db.update(disclosures).set({ politicianId: targetId }).where(eq(disclosures.politicianId, row.id));
    await db.update(researchSignals).set({ politicianId: targetId }).where(eq(researchSignals.politicianId, row.id));
    await db.update(alerts).set({ politicianId: targetId }).where(eq(alerts.politicianId, row.id));
    await db.update(watchlistItems).set({ politicianId: targetId }).where(eq(watchlistItems.politicianId, row.id));
    await db.delete(politicianStats).where(eq(politicianStats.politicianId, row.id));
    await db.delete(politicians).where(eq(politicians.id, row.id));
    merged += 1;
    console.log(`Merged duplicate House politician "${row.fullName}" -> "${cleanedName}"`);
  }

  console.log(`Name cleanup complete. cleaned=${cleaned} merged=${merged} skipped_collision=${skippedCollision}`);
}

cleanPoliticianDisplayNames().catch((error) => {
  console.error("Failed to clean politician display names:", error);
  process.exit(1);
});
