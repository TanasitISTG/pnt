import { z } from "zod";

/**
 * Search-parameter schemas for the auth screens.
 *
 * These live here rather than inline in the routes because every value in them is
 * written by a redirect the app does not fully own: Better Auth appends `?error=` and
 * `?token=` when it returns from a verification or reset link, and the confirmation
 * email we send points at `?verified=1`. TanStack Router's default search parser runs
 * `JSON.parse` over each value, so `1` arrives as a number and `true` as a boolean. A
 * schema that insists on `string` therefore rejects our own email's link, and the
 * reader lands on the error page instead of being told their address is confirmed.
 */

/**
 * Text that may be missing or malformed. `.catch(undefined)` follows `librarySearchSchema`:
 * a value we cannot read is treated as "not provided" rather than thrown out of a route,
 * so a mangled query string falls back to the page's default state instead of an error.
 */
const optionalText = z.string().optional().catch(undefined);

/**
 * A presence flag: `1`, `"1"` and `true` all mean set, while absence, `0`, `false` and
 * `null` mean not set. The string `"0"` cannot reach this schema — the parser has already
 * turned it into a number — so callers can test the result for truthiness directly.
 */
const flag = z.union([z.string(), z.number(), z.boolean()]).optional().catch(undefined);

/** The `?redirect=` target carried through sign in and sign up. */
export const authRedirectSearchSchema = z.object({ redirect: optionalText });

/** `?verified=1` from a confirmation link, or `?error=` when that link failed. */
export const verifyEmailSearchSchema = z.object({ verified: flag, error: optionalText });

/** `?token=` from a reset link, or `?error=` when the link was spent or expired. */
export const resetPasswordSearchSchema = z.object({ token: optionalText, error: optionalText });
