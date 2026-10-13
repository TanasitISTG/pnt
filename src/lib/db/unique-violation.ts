import "@tanstack/react-start/server-only";

/**
 * Postgres unique-violation (SQLSTATE 23505), raised by a partial unique index.
 *
 * Drizzle wraps a driver failure in its own error, so the SQLSTATE has to be read off the
 * cause chain; without that, a duplicate that a partial index refused would surface as a
 * generic failure instead of telling the caller what already exists. Shared by reporting
 * (one open report per account per target) and reviewing (one live review per account per
 * novel), which are the two places that lean on the index rather than a read-then-write
 * check.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = current.cause;
  }
  return false;
}
