// Route access rules shared by proxy.ts and tests.

/** Pages that require a signed-in user. */
export const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/profile", "/waitlist", "/problems", "/interview"] as const;

/** Pages a signed-in user should skip. */
export const GUEST_ONLY_PATHS = ["/login"] as const;

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export const isProtectedPath = (path: string) => PROTECTED_PREFIXES.some((p) => matches(path, p));
export const isGuestOnlyPath = (path: string) => GUEST_ONLY_PATHS.some((p) => matches(path, p));

/**
 * Pages that don't need a seat: interview rooms and invite links. Invited interviewers
 * sign in to be accountable in the session record, but don't take one of the 100
 * candidate seats (ADR 0005), so post-login routing skips claim_seat() for these.
 */
export const SEAT_FREE_PREFIXES = ["/interview"] as const;

export const isSeatFreePath = (path: string) => SEAT_FREE_PREFIXES.some((p) => matches(path.split(/[?#]/)[0], p));
