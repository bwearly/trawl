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

### Removal plan

When Auth.js is integrated:

- Replace seam internals with real Auth.js session user ID.
- Remove dev-auth routes.
- Remove dev switcher UI.
- Disable production fallback.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
