import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/cleanup-duplicate-users.ts", "utf8");

assert.ok(source.includes("DRY_RUN"), "Expected DRY_RUN support");
assert.ok(source.includes("parseBoolEnv(process.env.DRY_RUN, true)"), "Expected DRY_RUN to default true");
assert.ok(source.includes("TARGET_EMAIL") && source.includes("CANONICAL_USER_ID"), "Expected required TARGET_EMAIL/CANONICAL_USER_ID envs");
assert.ok(source.includes("Missing required input: TARGET_EMAIL and CANONICAL_USER_ID must both be set."), "Expected explicit required env message");
assert.ok(source.includes("notificationJobs") && source.includes("notificationEvents"), "Expected notification dependency checks");
assert.ok(source.includes("watchlistDigestDeliveries"), "Expected digest dependency checks");
assert.ok(source.includes("alertPreferences"), "Expected alert preferences handling");
assert.ok(source.includes("confirmDelete") && source.includes("CONFIRM_DELETE"), "Expected gated hard delete behavior");
assert.ok(source.includes("JSON.stringify(result, null, 2)"), "Expected final JSON output");
assert.ok(source.includes("cleanup-duplicate-users failed"), "Expected top-level failure JSON reason");

console.log("cleanup-duplicate-users validations passed");
