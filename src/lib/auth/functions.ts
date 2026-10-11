import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth, type Session, type User } from "@/lib/auth/auth";
import { UnauthorizedError, withSafeHandler } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

export function requireSession(session: { user: User; session: Session } | null) {
  // ponytail: single-admin model — disableSignUp:true ensures only seeded admin has session.
  // Revisit (add role check) if multi-user is ever allowed.
  if (!session) {
    log("warn", "auth failed: no session");
    throw new UnauthorizedError();
  }
  return session;
}

/*
 * The session lookups below are server-only functions, not server functions.
 *
 * Server code calls them (every mutation and route handler gates on a session),
 * while nothing in the browser graph ever does, and a server function that the
 * client graph never imports is absent from the server-function manifest that
 * resolves server-side RPC call sites — its calls then fail at runtime with
 * "Server function info not found" instead of reaching the implementation.
 * A server-only function is called directly and never consults that manifest.
 */
export const getSession = createServerOnlyFn(() =>
  withSafeHandler(async () => {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    return session;
  }),
);

export const ensureSession = createServerOnlyFn(() =>
  withSafeHandler(async () => {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    return requireSession(session);
  }),
);
