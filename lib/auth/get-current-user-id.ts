import { cookies } from "next/headers";

/**
 * Centralized fallback identity used by the temporary auth seam.
 */
export const DEMO_FALLBACK_USER_ID = "demo-user";
export const DEV_AUTH_COOKIE_NAME = "trawl_dev_user_id";
export const DEV_ALLOWED_USER_IDS = [
  DEMO_FALLBACK_USER_ID,
  "demo-user-2",
  "demo-user-3",
] as const;

export type DevAllowedUserId = (typeof DEV_ALLOWED_USER_IDS)[number];
export type AuthSource = "fallback" | "dev-cookie" | "session";

type UserIdResolution = {
  userId: string;
  source: AuthSource;
};

function isDevelopmentAuthEnabled() {
  return process.env.NODE_ENV !== "production";
}

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
  // Placeholder for future real session user id extraction.
  const sessionUserId = normalizeUserId(null);
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

  return { userId: DEMO_FALLBACK_USER_ID, source: "fallback" };
}

export async function getCurrentUserId() {
  return (await resolveCurrentUserIdentity()).userId;
}
