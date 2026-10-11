/**
 * The display name an account starts with.
 *
 * Email sign-up supplies one, and both social providers try to: Google maps the
 * profile's `name`, Discord maps `global_name || username`. That expression can still
 * come out empty (a Discord account with no global name and an unset username), and an
 * account with no name renders as a blank shell and a nameless byline, so the address
 * the provider verified is the fallback — it is the one piece of the profile that is
 * always present and already belongs to the reader.
 */

/** Matches the profile form's own limit, so an accepted name is always editable. */
export const FALLBACK_NAME_MAX_LENGTH = 50;

/** Last resort for a provider that returns neither a name nor an email. */
const PLACEHOLDER_NAME = "Reader";

export function fallbackDisplayName(user: { name?: unknown; email?: unknown }): string {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name) return name;

  const email = typeof user.email === "string" ? user.email.trim() : "";
  const local = email.includes("@") ? email.slice(0, email.indexOf("@")).trim() : "";
  return local.slice(0, FALLBACK_NAME_MAX_LENGTH) || PLACEHOLDER_NAME;
}
