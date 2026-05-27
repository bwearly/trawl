import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const drizzleDir = path.join(process.cwd(), "drizzle");
const migrationFiles = fs
  .readdirSync(drizzleDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

assert.ok(migrationFiles.length > 0, "Expected at least one drizzle SQL migration file");

const latestMigrationFile = migrationFiles[migrationFiles.length - 1];
const migrationSource = fs.readFileSync(path.join(drizzleDir, latestMigrationFile), "utf8").toLowerCase();

assert.ok(
  migrationSource.includes("create unique index") || migrationSource.includes("create unique index if not exists"),
  "Expected latest migration to create a unique index"
);
assert.ok(
  migrationSource.includes("users_normalized_email_unique"),
  "Expected latest migration to include users_normalized_email_unique index name"
);
assert.ok(
  migrationSource.includes("lower(trim(\"email\"))") || migrationSource.includes("lower(trim(email))"),
  "Expected latest migration to include lower(trim(email)) expression"
);
assert.ok(
  migrationSource.includes("where \"email\" is not null") || migrationSource.includes("where \"users\".\"email\" is not null") || migrationSource.includes("where email is not null"),
  "Expected latest migration to include where email is not null predicate"
);

console.log(`user email unique-index migration validation passed (${latestMigrationFile})`);

function safeDbTargetSummary(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname || null,
    port: parsed.port || null,
    database: parsed.pathname?.replace(/^\//, "") || null,
    ssl: parsed.searchParams.get("sslmode") ?? null,
  };
}

async function validateRuntimeDatabase() {
  const databaseUrl = process.env.TRAWL_DATABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL or TRAWL_DATABASE_DATABASE_URL must be set for runtime DB validation");

  const dbTarget = safeDbTargetSummary(databaseUrl);
  console.log("runtime DB target:", dbTarget);

  const duplicateRows = await db.execute(sql<{ normalizedEmail: string; duplicateCount: number }>`
    select lower(trim(email)) as "normalizedEmail", count(*)::int as "duplicateCount"
    from users
    where email is not null and trim(email) <> ''
    group by lower(trim(email))
    having count(*) > 1
    order by count(*) desc, lower(trim(email)) asc
  `);
  assert.equal((duplicateRows.rows ?? []).length, 0, "Connected DB has duplicate normalized emails");

  const indexRows = await db.execute(sql<{ indexname: string }>`
    select indexname
    from pg_indexes
    where schemaname = current_schema()
      and tablename = 'users'
      and indexname = 'users_normalized_email_unique'
  `);
  assert.ok((indexRows.rows ?? []).length > 0, "Connected DB is missing users_normalized_email_unique index");
  console.log("runtime DB validation passed: users_normalized_email_unique exists and no duplicate normalized emails found.");
}

validateRuntimeDatabase().catch((error) => {
  console.error("runtime DB validation failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
