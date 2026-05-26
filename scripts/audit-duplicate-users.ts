import { db } from "@/lib/db";
import {
  alertPreferences,
  notificationJobs,
  users,
  watchlistDigestDeliveries,
  watchlistItems,
  watchlists,
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

type DuplicateGroup = {
  normalizedEmail: string;
  duplicateCount: number;
};

type UserRow = {
  id: string;
  email: string | null;
  createdAt: Date;
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

async function main() {
  const duplicates = await db.execute(sql<DuplicateGroup>`
    select lower(trim(email)) as "normalizedEmail", count(*)::int as "duplicateCount"
    from users
    where email is not null and trim(email) <> ''
    group by lower(trim(email))
    having count(*) > 1
    order by count(*) desc, lower(trim(email)) asc
  `);

  const rows = duplicates.rows ?? [];
  if (rows.length === 0) {
    console.log("No duplicate normalized emails found.");
    return;
  }

  for (const group of rows) {
    const normalizedEmail = normalizeEmail(String(group.normalizedEmail));
    if (!normalizedEmail) continue;

    const relatedUsers = await db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
      .orderBy(desc(users.createdAt));

    const perUser = await Promise.all(
      relatedUsers.map(async (user): Promise<Record<string, unknown>> => {
        const [watchlistCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(watchlists)
          .where(eq(watchlists.userId, user.id));

        const [watchlistItemCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(watchlistItems)
          .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
          .where(eq(watchlists.userId, user.id));

        const [alertPrefCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(alertPreferences)
          .where(eq(alertPreferences.userId, user.id));

        const [digestCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(watchlistDigestDeliveries)
          .where(eq(watchlistDigestDeliveries.userId, user.id));

        const [notificationJobCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notificationJobs)
          .where(eq(notificationJobs.userId, user.id));

        return {
          userId: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          watchlists: Number(watchlistCount?.count ?? 0),
          watchlistItems: Number(watchlistItemCount?.count ?? 0),
          alertPreferences: Number(alertPrefCount?.count ?? 0),
          digestDeliveries: Number(digestCount?.count ?? 0),
          notificationJobs: Number(notificationJobCount?.count ?? 0),
        };
      })
    );

    console.log(
      JSON.stringify(
        {
          normalizedEmail,
          count: Number(group.duplicateCount),
          userIds: relatedUsers.map((u: UserRow) => u.id),
          users: perUser,
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error("Failed to audit duplicate users:", error);
  process.exit(1);
});
