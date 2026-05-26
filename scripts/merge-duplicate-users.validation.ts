import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/merge-duplicate-users.ts", "utf8");

assert.ok(source.includes("inArray("), "Expected inArray usage for duplicate ID filtering");
assert.ok(!source.includes("= any("), "Expected no invalid SQL ANY tuple usage");
assert.ok(source.includes("const DRY_RUN = (process.env.DRY_RUN ?? \"true\") !== \"false\";"), "Expected DRY_RUN default true behavior");
assert.ok(source.includes("CONFIRM_MERGE"), "Expected CONFIRM_MERGE gate");
assert.ok(source.includes("db.transaction("), "Expected confirmed merge writes to run in a transaction");
assert.ok(!source.includes("db.delete(users)"), "Script must not auto-delete duplicate user rows");
assert.ok(source.includes("Would move rows from duplicate users"), "Expected plan output before write");
assert.ok(source.includes("validateWatchlistMove"), "Expected watchlist safety validation");

console.log("merge-duplicate-users validations passed");
