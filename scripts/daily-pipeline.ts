import { spawnSync } from "node:child_process";

function runStep(label: string, command: string, args: string[]) {
  const startedAt = Date.now();
  console.log(`\n▶ ${label}`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.status !== 0) {
    throw new Error(
      `${label} failed after ${durationSeconds}s with exit code ${result.status ?? "unknown"}`,
    );
  }

  console.log(`✅ ${label} finished in ${durationSeconds}s`);
}

function getRecentYears() {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear, currentYear - 1, currentYear - 2];
}

async function main() {
  const years = getRecentYears();
  const yearsArg = `--years=${years.join(",")}`;

  console.log(`Starting daily pipeline for filing years: ${years.join(", ")}`);

  runStep("House import (recent years)", "npm", [
    "run",
    "house:import",
    "--",
    yearsArg,
    "--daily-mode",
  ]);
  runStep("Price import", "npm", ["run", "prices:import"]);
  runStep("Performance backfill", "npm", ["run", "performance:backfill:daily"]);
  runStep("Politician stats backfill", "npm", ["run", "politicians:backfill"]);
  runStep("Signal recalculation", "npm", ["run", "signals:recalculate"]);
  runStep("Alert backfill", "npm", ["run", "alerts:backfill"]);
  runStep("Pipeline health report", "npm", ["run", "pipeline:health"]);

  console.log("\n✅ Daily pipeline completed.");
  console.log(
    "Note: alerts:backfill currently depends on that script's configured user scope. Verify whether it is single-user or all-user before relying on daily alert generation for production.",
  );
}

main().catch((error) => {
  console.error("\n❌ Daily pipeline failed:", error);
  process.exit(1);
});
