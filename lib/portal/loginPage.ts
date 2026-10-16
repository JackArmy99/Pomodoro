// Did the portal send us to its sign-in page?
//
// An expired Community session redirects any page to
// /auth/login?came_from=… — a status-200 page that first says "Please wait",
// then shows the login form. A preview once presented exactly that as the
// webinar's content, so the address is checked explicitly.
//
// Kept in its own module, free of side effects, so tests can use it without
// loading lib/portal/session.ts (which fixes the profile location on import).
export function looksLikeLoginUrl(raw: string): boolean {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    return /(^|\/)(auth\/)?(login|log-in|signin|sign-in|sso)(\/|$)/.test(path);
  } catch {
    return false;
  }
}
