import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Invite links carry a 256-bit random token. Only its SHA-256 is stored (ADR 0005),
// so a database leak doesn't hand out working links.

export function generateInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export const hashInviteToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Tokens are 43 base64url characters; anything else is rejected before touching the database. */
export const isWellFormedToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
