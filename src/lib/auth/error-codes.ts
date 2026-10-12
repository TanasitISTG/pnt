/**
 * Better Auth error codes the auth pages have to tell apart.
 *
 * The sign-in form is the one place a reader meets these, and its default treatment
 * is "your email or password is wrong". A suspension is not that: it needs its own
 * copy, and it must not be followed by the hint about signing up with a provider.
 */

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
const INVALID_CREDENTIAL_CODES = new Set(["INVALID_EMAIL_OR_PASSWORD", "USER_NOT_FOUND"]);

export function isInvalidCredentialsError(code: string | undefined | null): boolean {
  return !!code && INVALID_CREDENTIAL_CODES.has(code);
}
