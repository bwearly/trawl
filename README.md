This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Temporary dev-auth identity switcher (dev only)

For local and development testing before real Auth.js integration, this project includes a temporary identity switcher.

> This is **dev-only** and must **not** be treated as production authentication.

### Routes

- `GET /api/dev-auth/current`
- `POST /api/dev-auth/switch`

### Allowed users

- `demo-user`
- `demo-user-2`
- `demo-user-3`

### Cookie

- `trawl_dev_user_id`

### UI

- Dev user switcher is available in the app nav/layout.

### Test user-scoped isolation

1. Switch between allowed users with the dev switcher UI.
2. Add watchlist items for one user.
3. Switch to a different user and add different watchlist items.
4. Verify watchlists, alerts, and preferences stay separated per user.

## Auth.js current policy and MVP behavior

Current auth wiring is intentionally transitional and **not** a production-ready auth model yet.

### Public browsing behavior

Public research/browsing remains available without sign-in:

- Home
- Signals feed
- Signal detail
- Politician leaderboard/detail
- Ticker detail
- Filtering/sorting/searching

Public pages intentionally **do not** decorate watch state from fallback `demo-user` identity. Signed-out users should see neutral watch UI state.

### Personalized behavior

Personalized features require a personalized identity:

- Accepted personalized identity sources:
  - Auth.js session user
  - Dev-cookie user (`trawl_dev_user_id`) in non-production
- Fallback `demo-user` is a seam fallback and is **not** treated as personalized for gated UX/API behavior.

When no personalized identity exists:

- `/watchlist` shows an inline sign-in prompt.
- `/alerts` shows an inline sign-in prompt.
- Personalized write/update APIs return `401` JSON:
  - watch/unwatch APIs
  - alert preference read/update APIs
  - alert mark-read mutation APIs

### Provider and environment notes

- Production provider is Google OAuth via Auth.js when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured.
- Dev-only Credentials (`Development Identity (temporary)`) remains available only when `NODE_ENV !== "production"`.
- `AUTH_SECRET` is required in production; startup fails clearly when missing.
- Production startup also fails clearly when Google OAuth env vars are missing.
- `/api/dev-auth/*` routes are dev-only and return `404` in production.

### Before protected production launch

1. Replace temporary credentials flow with a production identity provider.
2. Disable demo fallback for protected/personalized paths.
3. Remove dev-auth switcher/routes.
4. Keep `getCurrentUserId` and `getPersonalizedUserIdentity` as the central seam helpers while migrating route-by-route.


## User profile persistence (phase 1, additive)

Trawl now includes an additive `users` table used for basic profile persistence from authenticated Google sessions.

What this phase does:

- Upserts a `users` row keyed by the current Auth.js session user id (`session.user.id`) for Google-authenticated sessions.
- Stores profile fields when available: `email`, `name`, `image`.
- Updates `lastSignInAt` and `updatedAt` on each qualifying session callback.

What this phase intentionally does **not** do yet:

- No migration of `watchlists`, `alerts`, `notification_jobs`, `notification_events`, or `alert_preferences` ownership fields.
- No removal of legacy `user_id` columns.
- No change to `getCurrentUserId` behavior or fallback policy.
- No enablement of live email sending.
- No removal of the dev-auth switcher.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Alert email queue foundation (no live sending)

This repository now includes a **notification queue foundation** for alert email delivery, but **live email delivery is intentionally disabled**.

- Feature flag: `ALERT_EMAIL_QUEUE_ENABLED` (default behavior should be `false`).
- When disabled, in-app alert creation and behavior remain unchanged.
- No email provider SDK is configured yet.
- The current notification sender is a **no-op sender** that never sends real email.

### Queue processing

- Run `npm run notifications:process` to process queued notification jobs in small batches.
- Processor behavior is idempotent and safe to rerun.
- Without a configured provider, jobs resolve via no-op/suppressed outcomes only.

### Future requirements before live sending

- Verified user email source/profile data.
- Unsubscribe/suppression model.
- Provider adapter implementation (e.g. Resend/SendGrid/Postmark/SES).
- Delivery monitoring and failure handling policy.


## Production Auth.js configuration checklist

Required environment variable names for production launch:

- `AUTH_SECRET`
- `AUTH_URL`
- `NEXTAUTH_URL`
- `AUTH_TRUST_HOST`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`

Notes:

- Do not store secret values in source control.
- `/signin` now shows a non-secret readiness checklist when production auth config is incomplete.

Google OAuth redirect URL for Vercel production:

- `https://<your-vercel-domain>/api/auth/callback/google`

Example:

- `https://trawl.vercel.app/api/auth/callback/google`

Notes:

- Dev credentials are local/dev-only and are disabled in production.
- Session identity uses the Auth.js user id; for Google this is expected to be the stable Google account subject id. If a provider response only includes email, email may be used temporarily as the identity key.

## Daily pipeline GitHub Actions workflow

A scheduled GitHub Actions workflow is available at `.github/workflows/daily-pipeline.yml` to run the daily Trawl data pipeline.

### What it does

On each run, the workflow:

1. Checks out the repository.
2. Sets up Node.js (Node 20).
3. Installs dependencies with `npm ci`.
4. Runs `npm run pipeline:validate`.
5. Runs `npm run pipeline:daily`.

The schedule is set to `0 12 * * *` (12:00 UTC daily), which maps to early morning Mountain Time (about 5:00 AM MST / 6:00 AM MDT).

### Run manually

1. Go to **GitHub → Actions → Daily Trawl Pipeline**.
2. Click **Run workflow**.
3. Select the branch and confirm **Run workflow**.

### Required GitHub Secrets

Configure these repository secrets before enabling scheduled runs:

- `DATABASE_URL`
- `TRAWL_DATABASE_DATABASE_URL` (set this too if your runtime expects this variable name)
- `ALPHA_VANTAGE_API_KEY` (only if still required by your environment/integrations)
- `ALERT_BACKFILL_USER_ID` (optional; only needed if you intentionally scope alert backfill to one user)

The workflow also sets:

- `ALERT_EMAIL_QUEUE_ENABLED=false` (live email sending remains disabled)

### Alert backfill scope warning

Alert backfill behavior can still be scoped depending on how `alerts:backfill` is configured at runtime (for example, if `ALERT_BACKFILL_USER_ID` is provided).


## Senate PTR importer POC (read-only)

A Senate importer proof of concept is available for bounded, read-only normalization experiments:

```bash
npm run senate:import:poc -- --limit=5
```

Notes:

- Senate support is currently **POC-only**.
- The POC performs **no database writes** and does not change schema.
- The POC is **not** wired into the daily pipeline/cron jobs.
- Senate eFD source access constraints/terms must be reviewed before any production ingestion path.

## House metadata backfill notes

House PTR filings do **not** include party. Party must be populated from a separate member metadata source, not inferred from filings.

Current House import behavior:

- `state` can be parsed from PTR filing `State/District` values (e.g., `GA14` -> `GA`).
- `party` remains metadata-driven and is not inferred from PTR transaction rows.

To backfill House politician metadata safely:

```bash
npm run politicians:backfill-metadata
```

Notes:

- By default, this backfill only fills `party`/`state` when they are currently `NULL`.
- Use `--force` only when you intentionally want to allow overwriting existing values.
- Unmatched or ambiguous rows are written to `tmp/unmatched-politician-metadata.json`.
