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

- Current provider is temporary `next-auth` Credentials (`Development Identity (temporary)`), not production auth.
- `AUTH_SECRET` is required in production; startup fails clearly when missing.
- `/api/dev-auth/*` routes are dev-only and return `404` in production.

### Before protected production launch

1. Replace temporary credentials flow with a production identity provider.
2. Disable demo fallback for protected/personalized paths.
3. Remove dev-auth switcher/routes.
4. Keep `getCurrentUserId` and `getPersonalizedUserIdentity` as the central seam helpers while migrating route-by-route.

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
