import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DEMO_FALLBACK_USER_ID, DEV_ALLOWED_USER_IDS } from "@/lib/auth/auth-identity";

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.AUTH_SECRET) {
  throw new Error("Missing AUTH_SECRET in production. Set AUTH_SECRET before starting the app.");
}

const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers: isProduction
    ? []
    : [
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
        }),
      ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
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

export { handlers, auth, signIn, signOut };
