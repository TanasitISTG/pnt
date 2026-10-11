/**
 * Role vocabulary, in a module both graphs can import.
 *
 * The operator gate and the header's admin link have to agree, and the header runs in
 * the browser, so this stays free of server-only imports: `auth.ts` (server) and
 * `functions.ts` (server) both read from here rather than defining their own copy.
 */

/** The single role that unlocks operator screens. Mirrors the admin plugin config. */
export const ADMIN_ROLE = "admin";

/**
 * Roles are stored as a single string, and the admin plugin accepts a comma-separated
 * list, so a role check has to look at each segment. Comparison is exact to stay
 * consistent with the plugin's own authorization check.
 */
export function hasAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role.split(",").some((value) => value.trim() === ADMIN_ROLE);
}
