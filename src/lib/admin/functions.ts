import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count, desc, ilike, or, sql } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { ensureAdminSession } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { SafeServerError, withSafeHandler } from "@/lib/server-fn-error";
import {
  adminUserListInputSchema,
  adminUserIdSchema,
  setUserBannedSchema,
  setUserRoleSchema,
} from "@/lib/admin/schemas";

/**
 * Operator-only account administration.
 *
 * The list is read straight from the `user` table rather than through the admin
 * plugin's endpoint: paging, the search predicate, and the matching total have to
 * agree, and one query with a window-free count is the simplest way to keep them in
 * agreement. Mutations go through the plugin's own endpoints, which is what makes a
 * ban revoke the target's sessions and a role change follow the plugin's rules.
 *
 * Every function here is behind `ensureAdminSession`, and none of them will act on the
 * caller's own account: an operator who could demote, ban, or delete themselves could
 * lock the deployment out of its own controls.
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
  createdAt: Date;
}

export interface AdminUserPage {
  rows: AdminUserRow[];
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

/**
 * Refuses any moderation that would target the acting operator, which is the one
 * mistake that cannot be undone from inside the app.
 */
function assertNotSelf(sessionUserId: string, targetId: string): void {
  if (sessionUserId === targetId) {
    throw new SafeServerError("You cannot change your own operator account here.");
  }
}

function logAdminAction(
  action: string,
  operatorId: string,
  targetId: string,
  detail?: Record<string, unknown>,
): void {
  log("info", `admin ${action}`, { operatorId, targetId, ...detail });
}

export const setUserRole = createServerFn({ method: "POST" })
  .validator(setUserRoleSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);

      await auth.api.setRole({
        headers: getRequestHeaders(),
        body: { userId: data.userId, role: data.role },
      });
      logAdminAction("role changed", session.user.id, data.userId, { role: data.role });
      return { success: true };
    }),
  );

export const setUserBanned = createServerFn({ method: "POST" })
  .validator(setUserBannedSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);

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
      logAdminAction(
        data.banned ? "account banned" : "account unbanned",
        session.user.id,
        data.userId,
      );
      return { success: true };
    }),
  );

export const removeUser = createServerFn({ method: "POST" })
  .validator(adminUserIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureAdminSession();
      assertNotSelf(session.user.id, data.userId);

      await auth.api.removeUser({
        headers: getRequestHeaders(),
        body: { userId: data.userId },
      });
      logAdminAction("account deleted", session.user.id, data.userId);
      return { success: true };
    }),
  );
