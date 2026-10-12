/**
 * Reads the operator id the admin plugin stamps on an impersonated session.
 *
 * `$Infer` does not surface the columns a plugin owns, so a session object handed
 * back by the auth API is typed without `impersonatedBy` even though the column is
 * there. Rather than widening every inferred session type, the one dynamic field is
 * read through this accessor, which also means a malformed row reads as "not
 * impersonating" instead of turning a page load into a crash.
 */
export function impersonationOperatorId(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;

  const value = (session as { impersonatedBy?: unknown }).impersonatedBy;
  return typeof value === "string" && value.length > 0 ? value : null;
}
