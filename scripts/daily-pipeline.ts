import { spawnSync } from "node:child_process";

function runStep(label: string, command: string, args: string[]) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function getRecentYears() {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear, currentYear - 1, currentYear - 2];
}

async function main() {
  const years = getRecentYears();
  const yearsArg = `--years=${years.join(",")}`;

  runStep("House import (recent years)", "npm", ["run", "house:import", "--", yearsArg]);
  runStep("Price import", "npm", ["run", "prices:import"]);
  runStep("Performance backfill", "npm", ["run", "performance:backfill"]);
  runStep("Politician stats backfill", "npm", ["run", "politicians:backfill"]);
  runStep("Signal recalculation", "npm", ["run", "signals:recalculate"]);
  runStep("Alert backfill", "npm", ["run", "alerts:backfill"]);

  console.log("\n✅ Daily pipeline completed.");
}

main().catch((error) => {
  console.error("\n❌ Daily pipeline failed:", error);
  process.exit(1);
});
