import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DEMO_FALLBACK_USER_ID, DEV_ALLOWED_USER_IDS } from "@/lib/auth/auth-identity";

const isProduction = process.env.NODE_ENV === "production";
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const hasGoogleProviderConfig = Boolean(googleClientId && googleClientSecret);

if (isProduction && !process.env.AUTH_SECRET) {
  throw new Error("Missing AUTH_SECRET in production. Set AUTH_SECRET before starting the app.");
}

if (isProduction && !hasGoogleProviderConfig) {
  throw new Error(
    "Missing Google OAuth configuration in production. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before starting the app."
  );
}

const providers = [];

if (hasGoogleProviderConfig) {
  providers.push(
    Google({
      clientId: googleClientId!,
      clientSecret: googleClientSecret!,
    })
  );
}

if (!isProduction) {
  providers.push(
    Credentials({
      name: "Development Identity (temporary)",
      credentials: {
        userId: { label: "User ID", type: "text", placeholder: DEMO_FALLBACK_USER_ID },
      },
      authorize(rawCredentials) {
        const normalizedUserId =
          typeof rawCredentials?.userId === "string" ? rawCredentials.userId.trim() : "";
        if (!normalizedUserId) {
          return null;
        }
        const allowedInDev = DEV_ALLOWED_USER_IDS.includes(
          normalizedUserId as (typeof DEV_ALLOWED_USER_IDS)[number]
        );

        if (allowedInDev) {
          return { id: normalizedUserId, name: normalizedUserId };
        }

        return null;
      },
    })
  );
}

const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers,
  callbacks: {
    jwt({ token, user, account, profile }) {
      if (user?.id) {
        token.sub = user.id;
      } else if (account?.provider === "google") {
        const googleProfile = profile as { sub?: string; email?: string } | undefined;
        if (googleProfile?.sub) {
          token.sub = googleProfile.sub;
        } else if (googleProfile?.email) {
          token.sub = googleProfile.email;
          token.authUserIdSource = "google-email-fallback";
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user = {
          ...session.user,
          id: token.sub,
          name: session.user?.name ?? token.sub,
        };
      }
      return session;
    },
  },
});

export { auth, handlers, hasGoogleProviderConfig, signIn, signOut };
