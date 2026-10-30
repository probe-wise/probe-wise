// Route access rules shared by proxy.ts and tests.

/** Pages that require a signed-in user. */
export const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/profile", "/waitlist"] as const;

/** Pages a signed-in user should skip. */
export const GUEST_ONLY_PATHS = ["/login"] as const;

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export const isProtectedPath = (path: string) => PROTECTED_PREFIXES.some((p) => matches(path, p));
export const isGuestOnlyPath = (path: string) => GUEST_ONLY_PATHS.some((p) => matches(path, p));
