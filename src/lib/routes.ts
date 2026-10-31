// Route access rules shared by proxy.ts and tests.

/** Pages that require a signed-in user. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/account",
  "/candidates",
  "/team",
  "/problems",
  "/rubrics",
  "/loops",
  "/interview",
] as const;

/** Pages a signed-in user should skip. Candidates (anonymous sessions) may still use them. */
export const GUEST_ONLY_PATHS = ["/login"] as const;

/**
 * Protected pages a candidate's anonymous session may open: the interview room only.
 * Everything else sends them to /login.
 */
export const CANDIDATE_PREFIXES = ["/interview"] as const;

/** Pages reachable without a workspace: accepting a team invite, and interview rooms. */
export const WORKSPACE_FREE_PREFIXES = ["/team/join", "/interview"] as const;

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const pathOnly = (path: string) => path.split(/[?#]/)[0];

export const isProtectedPath = (path: string) => PROTECTED_PREFIXES.some((p) => matches(path, p));
export const isGuestOnlyPath = (path: string) => GUEST_ONLY_PATHS.some((p) => matches(path, p));
export const isCandidatePath = (path: string) => CANDIDATE_PREFIXES.some((p) => matches(pathOnly(path), p));
export const isWorkspaceFreePath = (path: string) => WORKSPACE_FREE_PREFIXES.some((p) => matches(pathOnly(path), p));
