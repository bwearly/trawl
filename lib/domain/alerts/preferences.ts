import { db } from "@/lib/db";
import { alertPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type AlertPreferences = {
  id: number;
  userId: string;
  minScore: number;
  enableWatchedTickerAlerts: boolean;
  enableWatchedPoliticianAlerts: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getOrCreateAlertPreferences(
  userId: string
): Promise<AlertPreferences> {
  const existing = await db
    .select()
    .from(alertPreferences)
    .where(eq(alertPreferences.userId, userId))
    .limit(1);

  if (existing[0]) {
    return {
      ...existing[0],
      minScore: toNumber(existing[0].minScore),
    };
  }

  const inserted = await db
    .insert(alertPreferences)
    .values({
      userId,
      minScore: "0",
      enableWatchedTickerAlerts: true,
      enableWatchedPoliticianAlerts: true,
      updatedAt: new Date(),
    })
    .returning();

  return {
    ...inserted[0],
    minScore: toNumber(inserted[0].minScore),
  };
}

export async function updateAlertPreferences(
  userId: string,
  updates: {
    minScore?: number;
    enableWatchedTickerAlerts?: boolean;
    enableWatchedPoliticianAlerts?: boolean;
  }
): Promise<AlertPreferences> {
  await getOrCreateAlertPreferences(userId);

  const payload: {
    minScore?: string;
    enableWatchedTickerAlerts?: boolean;
    enableWatchedPoliticianAlerts?: boolean;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (updates.minScore !== undefined) {
    payload.minScore = String(updates.minScore);
  }

  if (updates.enableWatchedTickerAlerts !== undefined) {
    payload.enableWatchedTickerAlerts = updates.enableWatchedTickerAlerts;
  }

  if (updates.enableWatchedPoliticianAlerts !== undefined) {
    payload.enableWatchedPoliticianAlerts =
      updates.enableWatchedPoliticianAlerts;
  }

  const updated = await db
    .update(alertPreferences)
    .set(payload)
    .where(eq(alertPreferences.userId, userId))
    .returning();

  return {
    ...updated[0],
    minScore: toNumber(updated[0].minScore),
  };
}