/**
 * Better Auth error codes the auth pages have to tell apart.
 *
 * The sign-in form is the one place a reader meets these, and its default treatment
 * is "your email or password is wrong". A suspension is not that: it needs its own
 * copy, and it must not be followed by the hint about signing up with a provider.
 */
import { encodeMessage, type MessageKey } from "@/lib/i18n/message-code";

/** The account is banned, whether or not an expiry is set. */
export const BANNED_USER = "BANNED_USER";

export function isBannedUserError(code: string | undefined | null): boolean {
  return code === BANNED_USER;
}

/**
 * Codes that mean the credentials themselves were rejected. Everything else - a
 * suspension, a rate limit, a captcha failure - is reported on its own terms rather
 * than as a wrong password.
 */
const INVALID_CREDENTIAL_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "INVALID_EMAIL",
  "INVALID_USER",
  "USER_NOT_FOUND",
  "CREDENTIAL_ACCOUNT_NOT_FOUND",
]);

export function isInvalidCredentialsError(code: string | undefined | null): boolean {
  return !!code && INVALID_CREDENTIAL_CODES.has(code);
}

/**
 * Better Auth's own error codes, mapped to the catalog the page is already rendering.
 *
 * The library's messages are English, and some of its failures have their own meaning:
 * an account that exists is not a failed signup, a suspended account is not a wrong
 * password. Returning a message code keeps that decision in one place and lets the
 * page resolve it in the reader's language, exactly like an app server error. A code
 * this table does not know falls back to the caller's page-specific sentence rather
 * than leaking English into a Thai page.
 */
const AUTH_ERROR_MESSAGES: Record<string, MessageKey> = {
  INVALID_EMAIL_OR_PASSWORD: "auth.signInFailed",
  INVALID_PASSWORD: "auth.signInFailed",
  INVALID_EMAIL: "auth.signInFailed",
  INVALID_USER: "auth.signInFailed",
  USER_NOT_FOUND: "auth.signInFailed",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "auth.signInFailed",
  USER_ALREADY_EXISTS: "auth.emailExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "auth.emailExists",
  [BANNED_USER]: "auth.accountSuspended",
  EMAIL_NOT_VERIFIED: "auth.emailNotVerified",
  INVALID_TOKEN: "auth.linkInvalid",
  TOKEN_EXPIRED: "auth.linkInvalid",
  SESSION_EXPIRED: "auth.sessionExpired",
  SESSION_NOT_FRESH: "auth.sessionExpired",
  PASSWORD_TOO_SHORT: "auth.passwordRejected",
  PASSWORD_TOO_LONG: "auth.passwordRejected",
  PASSWORD_ALREADY_SET: "auth.passwordRejected",
  USER_ALREADY_HAS_PASSWORD: "auth.passwordRejected",
  VERIFICATION_FAILED: "auth.challengeFailed",
  MISSING_RESPONSE: "auth.challengeFailed",
  SERVICE_UNAVAILABLE: "auth.challengeFailed",
  TOO_MANY_ATTEMPTS: "auth.rateLimited",
  EMAIL_ALREADY_VERIFIED: "auth.alreadyConfirmed",
  INVALID_ORIGIN: "auth.requestFailed",
  INVALID_CALLBACK_URL: "auth.requestFailed",
  INVALID_REDIRECT_URL: "auth.requestFailed",
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: "auth.requestFailed",
};

/**
 * The catalog message for a Better Auth failure.
 *
 * `fallbackKey` names the sentence the current page would otherwise show for a failure
 * it did not specifically recognise, and `fallbackValues` fills that sentence's
 * parameters. The result is always a message code, never the library's English.
 */
export function authErrorMessage(
  error: { code?: string | null; status?: number | null },
  fallbackKey: MessageKey,
  fallbackValues?: Record<string, string | number>,
): string {
  const mapped = error.code ? AUTH_ERROR_MESSAGES[error.code] : undefined;
  if (mapped) return encodeMessage(mapped);
  if (error.status === 429) return encodeMessage("auth.rateLimited");
  return encodeMessage(fallbackKey, fallbackValues);
}
