import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth, type Session, type User } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/server-fn-error";
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

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session;
});

export const ensureSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return requireSession(session);
});
