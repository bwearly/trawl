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
- `npm run prices:import` — imports ticker + SPY price history.
- `npm run performance:backfill` — computes disclosure return windows.
- `npm run politicians:backfill` — refreshes politician-level historical stats.
- `npm run signals:recalculate` — recomputes signal component scores and rationales.
- `npm run alerts:backfill` — regenerates historical alerts from current signal state.
- `npm run signals:evaluate` — prints score bucket/performance diagnostics.
- `npm run pipeline:daily` — runs the full daily pipeline (recent House years + all core backfills).

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
