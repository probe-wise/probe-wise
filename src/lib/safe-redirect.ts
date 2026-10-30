export const DEFAULT_AFTER_LOGIN = "/dashboard";

// Paths a post-login `next` may never point to (would loop or re-trigger auth).
const BLOCKED_PREFIXES = ["/auth", "/login"];

/**
 * Accept only same-origin, absolute paths for post-login redirects.
 * Blocks open redirects such as `//evil.com`, `/\evil.com`, `https://evil.com`,
 * encoded variants and control characters.
 */
export function safeNextPath(next: string | null | undefined, fallback = DEFAULT_AFTER_LOGIN): string {
  if (!next || typeof next !== "string" || next.length > 512) return fallback;

  let decoded = next;
  try {
    // Decode twice to catch double-encoded tricks like %252F%252F.
    decoded = decodeURIComponent(decodeURIComponent(next));
  } catch {
    return fallback;
  }

  for (const candidate of [next, decoded]) {
    if (!candidate.startsWith("/")) return fallback;
    if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
    if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;
  }

  // Final guard: resolving against a dummy origin must not change the origin.
  try {
    const url = new URL(next, "http://probewise.local");
    if (url.origin !== "http://probewise.local") return fallback;
    const path = url.pathname;
    if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
