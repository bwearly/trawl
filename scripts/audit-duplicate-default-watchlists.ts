import { db } from "@/lib/db";
import { users, watchlistItems, watchlists } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

type WatchlistDetail = {
  id: number;
  createdAt: Date;
  itemCount: number;
  isDefault: boolean;
};

async function main() {
  const rows = await db
    .select({
      userId: watchlists.userId,
      email: users.email,
      watchlistId: watchlists.id,
      isDefault: watchlists.isDefault,
      watchlistCreatedAt: watchlists.createdAt,
      itemCount: sql<number>`count(${watchlistItems.id})::int`,
    })
    .from(watchlists)
    .leftJoin(users, eq(users.id, watchlists.userId))
    .leftJoin(watchlistItems, eq(watchlistItems.watchlistId, watchlists.id))
    .groupBy(
      watchlists.userId,
      users.email,
      watchlists.id,
      watchlists.isDefault,
      watchlists.createdAt
    )
    .orderBy(desc(watchlists.userId), watchlists.id);

  const grouped = new Map<string, { email: string | null; watchlists: WatchlistDetail[] }>();
  for (const row of rows) {
    if (!grouped.has(row.userId)) {
      grouped.set(row.userId, { email: row.email ?? null, watchlists: [] });
    }
    grouped.get(row.userId)!.watchlists.push({
      id: row.watchlistId,
      createdAt: row.watchlistCreatedAt,
      itemCount: Number(row.itemCount ?? 0),
      isDefault: row.isDefault,
    });
  }

  const duplicates = [...grouped.entries()]
    .map(([userId, payload]) => {
      const defaults = payload.watchlists.filter((wl) => wl.isDefault);
      const totalItems = payload.watchlists.reduce((acc, wl) => acc + wl.itemCount, 0);
      return {
        userId,
        email: payload.email,
        defaultWatchlistIds: defaults.map((d) => d.id),
        defaults: defaults.map((d) => ({
          watchlistId: d.id,
          createdAt: d.createdAt,
          itemCount: d.itemCount,
        })),
        totalWatchlists: payload.watchlists.length,
        totalWatchlistItems: totalItems,
      };
    })
    .filter((row) => row.defaultWatchlistIds.length > 1)
    .sort((a, b) => b.defaultWatchlistIds.length - a.defaultWatchlistIds.length);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        duplicateDefaultWatchlistUsers: duplicates.length,
        users: duplicates,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
