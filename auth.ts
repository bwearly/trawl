import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { eq, or, sql } from "drizzle-orm";
import { DEMO_FALLBACK_USER_ID, DEV_ALLOWED_USER_IDS } from "@/lib/auth/auth-identity";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

const isProduction = process.env.NODE_ENV === "production";
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const hasGoogleProviderConfig = Boolean(googleClientId && googleClientSecret);

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function authLog(event: string, detail: Record<string, string | null | undefined>) {
  const safeDetail = Object.entries(detail).reduce<Record<string, string | null>>((acc, [k, v]) => {
    acc[k] = v ?? null;
    return acc;
  }, {});
  console.info(`[auth] ${event}`, safeDetail);
}

if (isProduction && !process.env.AUTH_SECRET) throw new Error("Missing AUTH_SECRET in production. Set AUTH_SECRET before starting the app.");
if (isProduction && !hasGoogleProviderConfig) throw new Error("Missing Google OAuth configuration in production. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before starting the app.");
const providers = [];
if (hasGoogleProviderConfig) providers.push(Google({ clientId: googleClientId!, clientSecret: googleClientSecret! }));
if (!isProduction) {
  providers.push(Credentials({ name: "Development Identity (temporary)", credentials: { userId: { label: "User ID", type: "text", placeholder: DEMO_FALLBACK_USER_ID } }, authorize(rawCredentials) {
    const normalizedUserId = typeof rawCredentials?.userId === "string" ? rawCredentials.userId.trim() : "";
    if (!normalizedUserId) return null;
    const allowedInDev = DEV_ALLOWED_USER_IDS.includes(normalizedUserId as (typeof DEV_ALLOWED_USER_IDS)[number]);
    if (allowedInDev) return { id: normalizedUserId, name: normalizedUserId };
    return null;
  } }));
}

const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers,
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account?.provider) token.authProvider = account.provider;

      const profileEmail = (profile as { email?: string } | undefined)?.email;
      const normalizedEmail = normalizeEmail(typeof token.email === "string" ? token.email : user?.email ?? profileEmail);

      if (account?.provider === "google") {
        const providerId =
          typeof account.providerAccountId === "string" && account.providerAccountId.trim()
            ? account.providerAccountId.trim()
            : typeof user?.id === "string" && user.id.trim()
              ? user.id.trim()
              : typeof token.sub === "string"
                ? token.sub
                : null;

        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(
            or(
              providerId ? eq(users.id, providerId) : undefined,
              normalizedEmail ? sql`lower(trim(${users.email})) = ${normalizedEmail}` : undefined
            )
          )
          .limit(1);

        if (existing[0]?.id) {
          token.sub = existing[0].id;
          authLog("jwt.reuse-existing-user", {
            provider: account.provider,
            providerUserId: providerId,
            normalizedEmail,
            reusedUserId: existing[0].id,
          });
        } else if (providerId) {
          token.sub = providerId;
          authLog("jwt.no-existing-user", {
            provider: account.provider,
            providerUserId: providerId,
            normalizedEmail,
            reusedUserId: null,
          });
        }
      } else if (user?.id) {
        token.sub = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user = { ...session.user, id: token.sub, name: session.user?.name ?? token.sub };
      }

      const resolvedUserId = typeof token.sub === "string" ? token.sub : null;
      const isGoogleSession = token.authProvider === "google";

      if (resolvedUserId && isGoogleSession) {
        const normalizedEmail = normalizeEmail(typeof token.email === "string" ? token.email : session.user?.email ?? null);
        const name = typeof token.name === "string" ? token.name : session.user?.name ?? null;
        const image = typeof token.picture === "string" ? token.picture : session.user?.image ?? null;

        const existingByEmail = normalizedEmail
          ? await db
              .select({ id: users.id })
              .from(users)
              .where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
              .limit(1)
          : [];

        const userIdToPersist = existingByEmail[0]?.id ?? resolvedUserId;
        if (existingByEmail[0]?.id && existingByEmail[0].id !== resolvedUserId) {
          token.sub = existingByEmail[0].id;
          session.user = { ...session.user, id: existingByEmail[0].id, name: session.user?.name ?? existingByEmail[0].id };
        }

        await db
          .insert(users)
          .values({
            id: userIdToPersist,
            email: normalizedEmail,
            name,
            image,
            updatedAt: new Date(),
            lastSignInAt: new Date(),
          })
          .onConflictDoUpdate({
            target: users.id,
            set: { email: normalizedEmail, name, image, updatedAt: new Date(), lastSignInAt: new Date() },
          });

        authLog("session.persist-user", {
          provider: "google",
          normalizedEmail,
          tokenUserId: resolvedUserId,
          persistedUserId: userIdToPersist,
        });
      }

      return session;
    },
  },
});

export { auth, handlers, hasGoogleProviderConfig, signIn, signOut };
