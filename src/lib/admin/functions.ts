import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count, desc, eq, ilike, or, sql } from "drizzle-orm";

import type { AdminActionDetail } from "@/lib/admin/audit";
import { auth } from "@/lib/auth/auth";
import { ensureAdminSession, getSession } from "@/lib/auth/functions";
import { impersonationOperatorId } from "@/lib/auth/impersonation";
import { hasAdminRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { adminAuditLog, user } from "@/lib/db/schema";
import { SafeServerError, UnauthorizedError, withSafeHandler } from "@/lib/server-fn-error";
import {
  adminActivityInputSchema,
  adminUserListInputSchema,
  adminUserIdSchema,
  setUserBannedSchema,
  setUserRoleSchema,
} from "@/lib/admin/schemas";
import { recordAdminAction } from "@/lib/admin/audit.server";

/**
 * Operator-only account administration.
 *
 * The lists are read straight from our own tables rather than through the admin
 * plugin's endpoints: paging, the search predicate, and the matching total have to
 * agree, and one query with a window-free count is the simplest way to keep them in
 * agreement. Mutations go through the plugin's own endpoints, which is what makes a
 * ban revoke the target's sessions and a role change follow the plugin's rules.
 *
 * Every function here is behind `ensureAdminSession`, and none of them will act on the
 * caller's own account: an operator who could demote, ban, or delete themselves could
 * lock the deployment out of its own controls. Each one also writes an audit row.
 */

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  createdAt: Date;
}

export interface AdminUserPage {
  rows: AdminUserRow[];
  rowCount: number;
  page: number;
  pageSize: number;
}

export interface AdminActivityRow {
  id: string;
  action: string;
  actorId: string;
  actorEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  detail: AdminActionDetail | null;
  createdAt: Date;
}

export interface AdminActivityPage {
  rows: AdminActivityRow[];
  rowCount: number;
  page: number;
  pageSize: number;
}

export const listAdminUsers = createServerFn({ method: "GET" })
  .validator(adminUserListInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<AdminUserPage> => {
      await ensureAdminSession();

      const term = `%${data.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
      const filter = data.q
        ? or(ilike(user.name, term), ilike(user.email, term), ilike(user.role, term))
        : undefined;

      const [rows, [totals]] = await Promise.all([
        db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            role: user.role,
            banned: sql<boolean>`coalesce(${user.banned}, false)`,
            banReason: user.banReason,
            banExpires: user.banExpires,
            termsVersion: user.termsVersion,
            termsAcceptedAt: user.termsAcceptedAt,
            createdAt: user.createdAt,
          })
          .from(user)
          .where(filter)
          .orderBy(desc(user.createdAt), desc(user.id))
          .limit(data.pageSize)
          .offset((data.page - 1) * data.pageSize),
        db.select({ value: count() }).from(user).where(filter),
      ]);

      return {
        rows,
        rowCount: Number(totals?.value ?? 0),
        page: data.page,
        pageSize: data.pageSize,
      };
    }),
  );

export const listAdminActivity = createServerFn({ method: "GET" })
  .validator(adminActivityInputSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<AdminActivityPage> => {
      await ensureAdminSession();

      const [rows, [totals]] = await Promise.all([
        db
          .select({
            id: adminAuditLog.id,
            action: adminAuditLog.action,
            actorId: adminAuditLog.actorId,
            actorEmail: adminAuditLog.actorEmail,
            targetUserId: adminAuditLog.targetUserId,
            targetEmail: adminAuditLog.targetEmail,
            detail: adminAuditLog.detail,
            createdAt: adminAuditLog.createdAt,
          })
          .from(adminAuditLog)
          .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
          .limit(data.pageSize)
          .offset((data.page - 1) * data.pageSize),
        db.select({ value: count() }).from(adminAuditLog),
      ]);

      return {
        rows,
        rowCount: Number(totals?.value ?? 0),
        page: data.page,
        pageSize: data.pageSize,
      };
    }),
  );

/**
 * Refuses any moderation that would target the acting operator, which is the one
 * mistake that cannot be undone from inside the app.
 */
function assertNotSelf(sessionUserId: string, targetId: string): void {
  if (sessionUserId === targetId) {
    throw new SafeServerError("You cannot change your own operator account here.");
  }
}

interface TargetAccount {
  id: string;
  email: string;
  role: string | null;
}

async function findTargetAccount(userId: string): Promise<TargetAccount> {
  const [target] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!target) throw new SafeServerError("That account no longer exists.");
  return target;
}

export const setUserRole = createServerFn({ method: "POST" })
  .validator(setUserRoleSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);
      const target = await findTargetAccount(data.userId);

      await auth.api.setRole({
        headers: getRequestHeaders(),
        body: { userId: data.userId, role: data.role },
      });
      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: hasAdminRole(data.role) ? "role.granted" : "role.revoked",
        targetUserId: target.id,
        targetEmail: target.email,
        detail: { role: data.role },
      });
      return { success: true };
    }),
  );

export const setUserBanned = createServerFn({ method: "POST" })
  .validator(setUserBannedSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);
      const target = await findTargetAccount(data.userId);

      const headers = getRequestHeaders();
      if (data.banned) {
        await auth.api.banUser({
          headers,
          body: {
            userId: data.userId,
            banReason: data.banReason,
            banExpiresIn: data.banExpiresInDays ? data.banExpiresInDays * 86_400 : undefined,
          },
        });
      } else {
        await auth.api.unbanUser({ headers, body: { userId: data.userId } });
      }

      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: data.banned ? "account.banned" : "account.unbanned",
        targetUserId: target.id,
        targetEmail: target.email,
        detail: data.banned
          ? {
              reason: data.banReason ?? null,
              expiresInDays: data.banExpiresInDays ?? null,
            }
          : null,
      });
      return { success: true };
    }),
  );

/**
 * The recovery action for a compromised account: it ends every session the target
 * holds, including any the operator is currently viewing through.
 */
export const revokeUserSessions = createServerFn({ method: "POST" })
  .validator(adminUserIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);
      const target = await findTargetAccount(data.userId);

      await auth.api.revokeUserSessions({
        headers: getRequestHeaders(),
        body: { userId: data.userId },
      });
      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "account.sessions_revoked",
        targetUserId: target.id,
        targetEmail: target.email,
      });
      return { success: true };
    }),
  );

export const removeUser = createServerFn({ method: "POST" })
  .validator(adminUserIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);
      const target = await findTargetAccount(data.userId);

      await auth.api.removeUser({
        headers: getRequestHeaders(),
        body: { userId: data.userId },
      });
      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "account.deleted",
        targetUserId: target.id,
        targetEmail: target.email,
      });
      return { success: true };
    }),
  );

/**
 * Starts a read-only session as another account.
 *
 * The impersonated session cannot write anything: `requireSession` refuses a session
 * with `impersonatedBy` set, and every mutation in the app authenticates through it.
 * Operator accounts are refused as targets - the plugin enforces that as well - so
 * this can never be a step toward taking over the deployment.
 */
export const startImpersonation = createServerFn({ method: "POST" })
  .validator(adminUserIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);
      const target = await findTargetAccount(data.userId);

      if (hasAdminRole(target.role)) {
        throw new SafeServerError("Operator accounts cannot be viewed as another account.");
      }

      await auth.api.impersonateUser({
        headers: getRequestHeaders(),
        body: { userId: data.userId },
      });
      await recordAdminAction({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "impersonation.started",
        targetUserId: target.id,
        targetEmail: target.email,
      });
      return { success: true };
    }),
  );

/**
 * Hands the browser back its operator session.
 *
 * It deliberately does not use `ensureAdminSession`: while viewing as another account
 * the acting session belongs to that account, so the operator gate would refuse the
 * one call that ends the impersonation. It needs an impersonated session instead,
 * which is also the only thing that can name the operator to return to.
 */
export const stopImpersonation = createServerFn({ method: "POST" }).handler(async () =>
  withSafeHandler(async (): Promise<{ success: true }> => {
    const session = await getSession();
    if (!session) throw new UnauthorizedError();

    const operatorId = impersonationOperatorId(session.session);
    if (!operatorId) throw new SafeServerError("You are not viewing as another account.");

    await auth.api.stopImpersonating({ headers: getRequestHeaders() });

    const [operator] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, operatorId))
      .limit(1);
    await recordAdminAction({
      actorId: operatorId,
      actorEmail: operator?.email ?? null,
      action: "impersonation.stopped",
      targetUserId: session.user.id,
      targetEmail: session.user.email,
    });
    return { success: true };
  }),
);
