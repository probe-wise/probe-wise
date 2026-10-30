// Map database errors from the session functions to messages safe to show users.
// The functions raise plain-English messages with specific SQLSTATEs; anything
// else (constraint names, internals) is replaced with a generic message.

const USER_FACING_CODES = new Set([
  "42501", // not allowed
  "22023", // invalid request / wrong state
  "22001", // too long
  "54000", // limit reached
  "P0002", // not found
  "28000", // not signed in
]);

export const GENERIC_SESSION_ERROR = "Something went wrong. Please try again.";

export function sessionErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return GENERIC_SESSION_ERROR;
  if (error.code && USER_FACING_CODES.has(error.code) && error.message && !/permission denied/i.test(error.message)) {
    return error.message;
  }
  return GENERIC_SESSION_ERROR;
}
