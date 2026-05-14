import { auth } from "@/auth";
import {
  DEMO_FALLBACK_USER_ID,
  DEV_ALLOWED_USER_IDS,
  DEV_AUTH_COOKIE_NAME,
  type DevAllowedUserId,
} from "@/lib/auth/auth-identity";
import { cookies } from "next/headers";
export type AuthSource = "fallback" | "dev-cookie" | "session";

type UserIdResolution = {
  userId: string;
  source: AuthSource;
};

function isDevelopmentAuthEnabled() {
  return process.env.NODE_ENV !== "production";
}

/**
 * Temporary launch seam flag.
 * MUST be set to false before enabling protected production routes.
 */
const ALLOW_DEMO_FALLBACK = true;

export function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function isAllowedDevUserId(value: unknown): value is DevAllowedUserId {
  const normalized = normalizeUserId(value);
  return normalized !== null && DEV_ALLOWED_USER_IDS.includes(normalized as DevAllowedUserId);
}

function resolveDevCookieUserId(cookieValue: unknown): DevAllowedUserId | null {
  if (!isDevelopmentAuthEnabled()) {
    return null;
  }

  return isAllowedDevUserId(cookieValue) ? cookieValue : null;
}

/**
 * Temporary auth migration seam.
 *
 * Current behavior: no real session auth yet. In non-production, a validated
 * dev cookie may select from a tiny allowlist. Otherwise fallback is demo-user.
 *
 * Future behavior: resolve authenticated session user id here first, and keep
 * fallback disabled for protected production routes.
 */
export async function resolveCurrentUserIdentity(): Promise<UserIdResolution> {
  const session = await auth();
  const sessionUserId = normalizeUserId(session?.user?.id);
  if (sessionUserId) {
    return { userId: sessionUserId, source: "session" };
  }

  if (isDevelopmentAuthEnabled()) {
    const cookieStore = await cookies();
    const devCookieUserId = resolveDevCookieUserId(
      cookieStore.get(DEV_AUTH_COOKIE_NAME)?.value
    );

    if (devCookieUserId) {
      return { userId: devCookieUserId, source: "dev-cookie" };
    }
  }

  if (ALLOW_DEMO_FALLBACK) {
    return { userId: DEMO_FALLBACK_USER_ID, source: "fallback" };
  }

  throw new Error("No authenticated user resolved and demo fallback is disabled.");
}

export async function getCurrentUserId() {
  return (await resolveCurrentUserIdentity()).userId;
}


export type PersonalizedUserIdentity = {
  userId: string;
  source: Extract<AuthSource, "session" | "dev-cookie">;
};

export async function getCurrentUserIdentity() {
  return resolveCurrentUserIdentity();
}

export async function getPersonalizedUserIdentity(): Promise<PersonalizedUserIdentity | null> {
  const identity = await resolveCurrentUserIdentity();
  if (identity.source === "session") {
    return identity;
  }
  if (identity.source === "dev-cookie" && isDevelopmentAuthEnabled()) {
    return identity;
  }
  return null;
}

export async function requirePersonalizedUser(): Promise<PersonalizedUserIdentity> {
  const identity = await getPersonalizedUserIdentity();
  if (!identity) {
    throw new Error("PERSONALIZED_AUTH_REQUIRED");
  }
  return identity;
}
