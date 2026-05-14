/**
 * Shared temporary auth identity constants for session + dev seam behavior.
 */
export const DEMO_FALLBACK_USER_ID = "demo-user";
export const DEV_AUTH_COOKIE_NAME = "trawl_dev_user_id";
export const DEV_ALLOWED_USER_IDS = [
  DEMO_FALLBACK_USER_ID,
  "demo-user-2",
  "demo-user-3",
] as const;

export type DevAllowedUserId = (typeof DEV_ALLOWED_USER_IDS)[number];
