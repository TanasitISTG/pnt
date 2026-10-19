/**
 * The sign-in method a browser used last, as Better Auth's `lastLoginMethod` plugin records it.
 *
 * The plugin keeps this on the device, in a first-party cookie written only on a response that
 * already carried a session - so it says "this browser last signed in with X" and nothing about
 * the account behind an address. That is the whole safety property of the pattern: the hint must
 * never be derived from something typed into the form, because doing so would turn the login page
 * into an account-enumeration oracle. Only the cookie is ever read.
 *
 * The name is owned here and passed to the plugin rather than left at the library's default, so
 * the writer and the reader cannot drift apart.
 */
export const LAST_LOGIN_METHOD_COOKIE = "better-auth.last_used_login_method";

/** Thirty days, matching the plugin's own default and the duration the cookie policy states. */
export const LAST_LOGIN_METHOD_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The social providers this app offers, which are the only non-password methods it has. */
export type SocialProvider = "google" | "discord";

export type LastLoginMethod = "email" | SocialProvider;

/**
 * The values this app can act on. A method the deployment no longer offers - or a value someone
 * set by hand - is not a hint worth showing, so it reads as absent rather than as an error.
 */
const KNOWN_METHODS: ReadonlySet<string> = new Set<LastLoginMethod>(["email", "google", "discord"]);

/**
 * The method named by a request's `Cookie` header, or null.
 *
 * Deliberately strict: the cookie name must match exactly (a prefix must not match), the first
 * pair with that name wins, and a value outside the known vocabulary - including malformed
 * percent-encoding - yields null instead of throwing while a page renders.
 */
export function parseLastLoginMethod(
  cookieHeader: string | null | undefined,
): LastLoginMethod | null {
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== LAST_LOGIN_METHOD_COOKIE) continue;

    const raw = pair.slice(separator + 1).trim();
    if (!raw) return null;

    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      return null;
    }
    return KNOWN_METHODS.has(value) ? (value as LastLoginMethod) : null;
  }

  return null;
}
