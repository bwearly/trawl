import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/merge-duplicate-users.ts", "utf8");

assert.ok(source.includes("if (import.meta.main)"), "Expected main() to be invoked via import.meta.main");
assert.ok(source.includes("main();"), "Expected main() call in import.meta.main block");
assert.ok(source.includes("inArray("), "Expected inArray usage for duplicate ID filtering");
assert.ok(!source.includes("= any("), "Expected no invalid SQL ANY tuple usage");
assert.ok(source.includes("parseBoolEnv"), "Expected explicit boolean env parsing");
assert.ok(source.includes("Missing required input: set TARGET_EMAIL or CANONICAL_USER_ID."), "Expected explicit missing target message");
assert.ok(source.includes("plannedRowMovesByTable"), "Expected dry-run plan output field");
assert.ok(source.includes("transactionCommitted"), "Expected committed/rolled-back status field");
assert.ok(source.includes("result.status = \"blocked\""), "Expected blocked status for watchlist conflict path");
assert.ok(source.includes("multiple default watchlists"), "Expected exact blocking reason for watchlist conflicts");
assert.ok(source.includes("JSON.stringify(result, null, 2)"), "Expected final JSON result emission");
assert.ok(!source.includes("db.delete(users)"), "Script must not auto-delete duplicate user rows");

console.log("merge-duplicate-users validations passed");
