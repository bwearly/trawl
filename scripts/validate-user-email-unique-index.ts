import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
