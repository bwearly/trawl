# Trawl

Congressional disclosure ingestion + signal scoring app built with Next.js.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful Scripts

- `npm run house:import -- --years=2026,2025,2024` — imports House disclosures for specific years.
- `npm run pipeline:validate` — runs deterministic pipeline validation assertions across:
  - normalization
  - asset resolution
  - trade type normalization
  - alert eligibility
  - scoring thresholds
  - performance windows
  - missing-price classification
  - Current expected state: pass with **80 assertions**.
- `npm run prices:import` — imports ticker + SPY price history.
  - Price symbol aliases handled during import: `APPL → AAPL`, `BRKB → BRK.B` (Yahoo `BRK-B`), and `BF.B/BF-B` normalization.
  - Imports Yahoo price history.
  - Unresolved/failed symbols are written to `tmp/price-import-unresolved-symbols.json` for separate review and richer failure diagnostics.
- `npm run pipeline:health` — reports pipeline health coverage + warnings across:
  - disclosure coverage
  - price coverage
  - performance coverage
  - signal coverage
  - alert coverage
  - watchlist/user coverage
- `npm run performance:backfill` — computes disclosure return windows.
- `npm run politicians:backfill` — refreshes politician-level historical stats.
- `npm run signals:recalculate` — recomputes signal component scores and rationales.
- `npm run alerts:backfill` — regenerates historical alerts from current signal state.
- `npm run signals:evaluate` — prints score bucket/performance diagnostics.
- `npm run prices:review-missing` — groups unresolved/missing price tickers by classification and writes `tmp/missing-price-review.json`.
  - Can run without `tmp/price-import-unresolved-symbols.json`, but failure reasons are richer after `npm run prices:import`.
- `npm run disclosures:repair-tickers` — disclosure ticker repair in **dry-run** mode (no writes).
- `APPLY_REPAIRS=true npm run disclosures:repair-tickers` — disclosure ticker repair in **apply** mode.
  - Includes repair/protection for `AT&T Inc` ticker correction: `AT -> T`.
  - Includes false-positive parser-noise cleanup by setting `ticker=null` only for exact safe matches.
  - Future imports are protected by asset-name guards for: `Appell Pete Corp`, `Interest`, `Issued`, `Shares`, and `NEW`.
- `npm run pipeline:daily` — runs the full daily pipeline (recent House years + all core backfills).

## Local Reliability Review Workflow

Recommended command sequence after pipeline-affecting changes:

```bash
npm run pipeline:validate
npm run prices:import
npm run pipeline:health
npm run prices:review-missing
npm run lint
```

Current expected state:

- `pipeline:validate` passes with 80 assertions.
- false-positive parser-noise review bucket should be `0` after cleanup.
- user-scoped `demo-user` warning is expected until real auth is added.

## Daily Automation

`npm run pipeline:daily` executes:

1. House import for current year and prior 2 years.
2. Price import.
3. Performance backfill.
4. Politician stats backfill.
5. Signal recalculation.
6. Alert backfill.

### Cron examples (no secrets wired)

Use whichever scheduler you already trust in your deployment environment.

#### Linux cron

```cron
# 9:10 UTC daily
10 9 * * * cd /path/to/trawl && npm run pipeline:daily >> /var/log/trawl-pipeline.log 2>&1
```

#### Vercel Cron

Create an API route or server action that triggers this pipeline in your job runtime, then add:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-pipeline",
      "schedule": "10 9 * * *"
    }
  ]
}
```

#### GitHub Actions schedule

```yaml
on:
  schedule:
    - cron: "10 9 * * *"

jobs:
  daily-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run pipeline:daily
```

Keep secrets/env vars in your scheduler's secure settings; this repo intentionally does not hardwire production credentials.

## Auth migration note (current status)

- Package installation for Auth.js is currently blocked in this environment (`npm` registry 403), so `next-auth` is not wired yet.
- Intended first implementation is `next-auth` with a Credentials provider and JWT sessions to avoid immediate DB schema changes.
- `getCurrentUserId()` is the migration seam: it should later resolve authenticated session user ID first, and fallback to `"demo-user"` when no session exists.
