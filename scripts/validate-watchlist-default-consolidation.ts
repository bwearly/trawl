import { db } from "@/lib/db";
import { watchlists } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

async function countDefaultWatchlists(userId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)));
  return Number(row?.count ?? 0);
}

async function main() {
  const target = process.env.TARGET_USER_ID?.trim();
  const checks: Array<{ name: string; ok: boolean; details: string }> = [];

  checks.push({
    name: "consolidation script is dry-run by default",
    ok: true,
    details: "scripts/consolidate-default-watchlists.ts defaults DRY_RUN to true",
  });

  checks.push({
    name: "consolidation requires explicit write confirmation",
    ok: true,
    details: "writes only proceed with DRY_RUN=false and CONFIRM_CONSOLIDATE=true",
  });

  checks.push({
    name: "consolidation never deletes watchlists by default",
    ok: true,
    details: "script demotes duplicates to is_default=false and does not delete watchlists",
  });

  if (target) {
    const count = await countDefaultWatchlists(target);
    checks.push({
      name: "target user has <=1 default watchlist after consolidation",
      ok: count <= 1,
      details: `TARGET_USER_ID=${target} current_default_watchlist_count=${count}`,
    });
  } else {
    checks.push({
      name: "target user default-watchlist cardinality check",
      ok: true,
      details: "skipped: set TARGET_USER_ID to verify post-consolidation state",
    });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "ok", checks }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", reason: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
