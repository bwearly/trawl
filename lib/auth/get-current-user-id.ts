/**
 * Temporary auth migration seam.
 *
 * For now, this preserves current demo behavior by always returning the
 * existing fallback user id. As real authentication is introduced, this helper
 * should be updated to return the authenticated session user id.
 *
 * TODO(auth.js): once `next-auth` can be installed in this environment,
 * resolve the session user id first (Credentials + JWT strategy), then
 * fallback to "demo-user" when no session exists.
 */
export function getCurrentUserId() {
  return "demo-user";
}
