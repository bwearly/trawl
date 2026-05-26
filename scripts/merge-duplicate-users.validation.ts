import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/merge-duplicate-users.ts", "utf8");

assert.ok(!source.includes("if (import.meta.main)"), "Expected no import.meta.main guard that can skip execution");
assert.ok(source.includes("main().catch((error) => {"), "Expected unconditional main() invocation with catch handler");
assert.ok(source.includes("merge-duplicate-users failed"), "Expected CLI-level fallback error reason for entrypoint failures");
assert.ok(source.includes("emitFinalResult("), "Expected centralized final JSON emission path");
assert.ok(source.includes("JSON.stringify(result, null, 2)"), "Expected final JSON result emission");
assert.ok(source.includes("process.exitCode = exitCode"), "Expected nonzero exit to avoid silent process.exit flush loss");
assert.ok(source.includes("inArray("), "Expected inArray usage for duplicate ID filtering");
assert.ok(!source.includes("= any("), "Expected no invalid SQL ANY tuple usage");
assert.ok(source.includes("db.transaction("), "Expected confirmed path to use a transaction");
assert.ok(source.includes("movedRowsByTable"), "Expected row counts output for confirmed path");
assert.ok(source.includes("Missing required input: TARGET_EMAIL and CANONICAL_USER_ID must both be set."), "Expected explicit required env message");
assert.ok(source.includes("debugMode"), "Expected MERGE_DEBUG instrumentation");
assert.ok(source.includes('debugLog(debugMode, "script started")'), "Expected script-start debug log");
assert.ok(source.includes('debugLog(debugMode, "parsed env"'), "Expected parsed-env debug log");
assert.ok(source.includes('debugLog(debugMode, "final result printed"'), "Expected final-result debug log");
assert.ok(!source.includes("db.delete(users)"), "Script must not auto-delete duplicate user rows");

console.log("merge-duplicate-users validations passed");
