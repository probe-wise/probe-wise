// Map Supabase Auth errors (and our own callback error codes) to user-facing copy.
// Never show raw provider/database errors to users.

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  over_email_send_rate_limit: "Too many emails sent. Wait a minute, then try again.",
  over_request_rate_limit: "Too many attempts. Wait a minute, then try again.",
  email_address_invalid: "That email address doesn't look right.",
  email_address_not_authorized: "We can't send email to that address yet.",
  otp_expired: "That code or link has expired. Request a new one.",
  otp_disabled: "Email sign-in is turned off right now.",
  invalid_code: "That code isn't right. Check the latest email and try again.",
  bad_code_verifier:
    "This sign-in link was opened in a different browser than the one you started in. Request a new link, or enter the 6-digit code instead.",
  flow_state_not_found: "This sign-in link was already used or has expired. Request a new one.",
  flow_state_expired: "This sign-in link has expired. Request a new one.",
  provider_disabled: "That sign-in method isn't enabled yet.",
  oauth_provider_not_supported: "That sign-in method isn't enabled yet.",
  signup_disabled: "New sign-ups are paused right now.",
  user_banned: "This account has been suspended.",
  access_denied: "Sign-in was cancelled.",
  missing_code: "The sign-in link is incomplete. Request a new one.",
  seat_check_failed: "You're signed in, but we couldn't check seat availability. Try again in a moment.",
  not_configured: "Sign-in isn't configured on this deployment yet.",
  unknown: "Something went wrong signing you in. Please try again.",
};

type MaybeAuthError = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

export function authErrorCode(error: MaybeAuthError): string {
  if (!error) return "unknown";
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) return error.code;
  if (error.status === 429) return "over_request_rate_limit";
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("expired")) return "otp_expired";
  if (msg.includes("invalid") && msg.includes("token")) return "invalid_code";
  if (msg.includes("code verifier")) return "bad_code_verifier";
  if (msg.includes("rate limit")) return "over_request_rate_limit";
  return "unknown";
}

export function authErrorMessage(codeOrError: string | MaybeAuthError): string {
  const code = typeof codeOrError === "string" ? codeOrError : authErrorCode(codeOrError);
  return AUTH_ERROR_MESSAGES[code] ?? AUTH_ERROR_MESSAGES.unknown;
}

/**
 * OAuth providers report failures as `?error=...&error_code=...&error_description=...`
 * on the callback URL. Normalise those to one of our codes.
 */
export function callbackErrorCode(params: URLSearchParams): string | null {
  const error = params.get("error");
  const code = params.get("error_code");
  if (!error && !code) return null;
  if (code && AUTH_ERROR_MESSAGES[code]) return code;
  if (error && AUTH_ERROR_MESSAGES[error]) return error;
  return "unknown";
}
