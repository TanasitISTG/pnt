import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth, type Session, type User } from "@/lib/auth/auth";
import { ADMIN_ROLE, hasAdminRole } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { UnauthorizedError, withSafeHandler } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

export { ADMIN_ROLE, hasAdminRole };

export type AuthenticatedSession = { user: User; session: Session };

export function requireSession(session: AuthenticatedSession | null): AuthenticatedSession {
  // Any account is a full account: every user owns an isolated workspace, and
  // ownership (not identity) is what gates a resource. Operator screens call
  // `requireAdminSession` on top of this instead.
  if (!session) {
    log("warn", "auth failed: no session");
    throw new UnauthorizedError();
  }
  return session;
}

/**
 * Operator gate. Every admin server function uses this, so no route handler has to
 * implement the rule itself.
 */
export function requireAdminSession(session: AuthenticatedSession | null): AuthenticatedSession {
  const authenticated = requireSession(session);
  if (!hasAdminRole(authenticated.user.role)) {
    log("warn", "admin access denied", { userId: authenticated.user.id });
    throw new UnauthorizedError();
  }
  return authenticated;
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

export const ensureAdminSession = createServerOnlyFn(() =>
  withSafeHandler(async () => {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    return requireAdminSession(session);
  }),
);

export interface AuthMethods {
  emailPassword: boolean;
  google: boolean;
  discord: boolean;
  /**
   * Public Turnstile site key, or null when the challenge is not enforced in this
   * deployment. Served from the server so the browser and the verifier can never
   * disagree about whether a challenge is required.
   */
  turnstileSiteKey: string | null;
}

/**
 * Which sign-in methods this deployment actually offers.
 *
 * The auth pages render provider buttons and the Turnstile widget from this rather
 * than from build-time flags, so an unconfigured provider is simply absent instead
 * of being shown and then failing at the callback.
 */
export const getAuthMethods = createServerFn({ method: "GET" }).handler(() =>
  withSafeHandler(async (): Promise<AuthMethods> => ({
    emailPassword: true,
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    discord: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? (env.TURNSTILE_SITE_KEY ?? null) : null,
  })),
);
