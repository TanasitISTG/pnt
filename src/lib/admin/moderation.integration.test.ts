import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";
import { hashPassword } from "better-auth/crypto";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

import { describeBan } from "./ban-status";

type AuthApi = typeof import("@/lib/auth/auth").auth;

let sql: Sql;
let auth: AuthApi;
/**
 * Imported in `beforeAll`, never at the top of the file: the audit writer pulls in the
 * pooled database client, which binds `DATABASE_URL` when it is first imported. A
 * static import would bind the application database before the test could point the
 * process at the disposable one.
 */
let recordAdminAction: typeof import("./audit.server").recordAdminAction;

const password = "moderation-password";
let operatorId: string;
let operatorEmail: string;
let memberId: string;
let memberEmail: string;

function cookiePair(headers: Headers, name: string): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie")?.split(/,(?=\s*(?:__Secure-)?[a-z_.-]+=)/) ?? []);
  const cookie = setCookies.find((value) => new RegExp(`^(?:__Secure-)?${name}=`).test(value));
  if (!cookie) throw new Error(`Better Auth did not return a ${name} cookie`);
  return cookie.split(";", 1)[0]!;
}

/**
 * Every cookie the response set, which is what a browser would send back next.
 *
 * Signing in as another account rewrites the session cookie in the same response that
 * retires the old one, so the last value for a name wins - which is also the order a
 * browser applies them in.
 */
function cookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie")?.split(/,(?=\s*(?:__Secure-)?[a-z_.-]+=)/) ?? []);

  const byName = new Map<string, string>();
  for (const value of setCookies) {
    const pair = value.split(";", 1)[0]!;
    byName.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  return [...byName.values()].join("; ");
}

async function insertUser(id: string, email: string, role: string | null): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "role", "created_at", "updated_at")
    VALUES (${id}, 'Moderation Test User', ${email}, true, ${role}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO "account" (
      "id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"
    ) VALUES (
      ${randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)}, ${now}, ${now}
    )
  `;
}

async function signIn(email: string): Promise<Headers> {
  const result = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: process.env.BETTER_AUTH_URL! }),
    returnHeaders: true,
  });
  return new Headers({ cookie: cookiePair(result.headers, "better-auth.session_token") });
}

async function readBanRow(userId: string): Promise<{
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
}> {
  const [row] = await sql<
    { banned: boolean | null; ban_reason: string | null; ban_expires: Date | null }[]
  >`SELECT "banned", "ban_reason", "ban_expires" FROM "user" WHERE "id" = ${userId}`;
  return {
    banned: row!.banned ?? false,
    banReason: row!.ban_reason,
    banExpires: row!.ban_expires,
  };
}

describeIntegration("operator moderation", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 10 }));
    ({ auth } = await import("@/lib/auth/auth"));
    ({ recordAdminAction } = await import("./audit.server"));

    operatorId = `mod-operator-${randomUUID()}`;
    operatorEmail = `${operatorId}@example.test`;
    memberId = `mod-member-${randomUUID()}`;
    memberEmail = `${memberId}@example.test`;
    await insertUser(operatorId, operatorEmail, "admin");
    await insertUser(memberId, memberEmail, "user");
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM "user" WHERE "id" IN (${operatorId}, ${memberId})`;
    await sql`DELETE FROM "admin_audit_log" WHERE "actor_id" = ${operatorId} OR "actor_id" = ${memberId}`;
    await closeIntegrationDatabase();
  });

  it("records an audit row that survives the account it names", async () => {
    await recordAdminAction({
      actorId: operatorId,
      actorEmail: operatorEmail,
      action: "role.granted",
      targetUserId: memberId,
      targetEmail: memberEmail,
      detail: { role: "admin" },
    });

    const [row] = await sql<
      { action: string; actor_email: string | null; target_email: string | null; detail: unknown }[]
    >`SELECT "action", "actor_email", "target_email", "detail" FROM "admin_audit_log"
      WHERE "target_user_id" = ${memberId} AND "action" = 'role.granted'`;
    expect(row).toMatchObject({
      action: "role.granted",
      actor_email: operatorEmail,
      target_email: memberEmail,
      detail: { role: "admin" },
    });
  });

  it("ends the target's sessions and refuses its next sign-in while banned", async () => {
    const memberSession = await signIn(memberEmail);
    expect(await auth.api.getSession({ headers: memberSession })).not.toBeNull();

    await auth.api.banUser({
      headers: await signIn(operatorEmail),
      body: { userId: memberId, banReason: "spam in chapters", banExpiresIn: 7 * 86_400 },
    });

    // The ban is what signs the account out everywhere it was signed in.
    expect(await auth.api.getSession({ headers: memberSession })).toBeNull();
    await expect(
      auth.api.signInEmail({
        body: { email: memberEmail, password },
        headers: new Headers({ origin: process.env.BETTER_AUTH_URL! }),
      }),
    ).rejects.toThrow(/suspended/i);

    const stored = await readBanRow(memberId);
    expect(stored.banReason).toBe("spam in chapters");
    expect(describeBan(stored).state).toBe("suspended");
  });

  it("clears a lapsed suspension on the account's next sign-in", async () => {
    // The lapse is written directly rather than through `banExpiresIn`, because the
    // app's timestamp mapping reads a naive column with a host-local offset: a
    // sub-hour margin would prove nothing here, while two days is unambiguously past
    // under either reading. The behavior under test is the plugin's own check, which
    // is what the operator screen mirrors.
    await sql`UPDATE "user" SET "ban_expires" = now() - interval '2 days' WHERE "id" = ${memberId}`;
    // Before signing in, the stored row still claims a ban the plugin has stopped
    // enforcing; the operator screen reads that as expired, which is the point.
    expect(describeBan(await readBanRow(memberId)).state).toBe("expired");

    await expect(signIn(memberEmail)).resolves.toBeInstanceOf(Headers);

    const cleared = await readBanRow(memberId);
    expect(cleared).toEqual({ banned: false, banReason: null, banExpires: null });
    expect(describeBan(cleared).state).toBe("active");
  });

  it("revokes every session a target holds", async () => {
    const memberSession = await signIn(memberEmail);
    await auth.api.revokeUserSessions({
      headers: await signIn(operatorEmail),
      body: { userId: memberId },
    });

    expect(await auth.api.getSession({ headers: memberSession })).toBeNull();
    await expect(signIn(memberEmail)).resolves.toBeInstanceOf(Headers);
  });

  it("mints a session as the viewed account, refuses its writes, and hands the operator back", async () => {
    const operatorSession = await signIn(operatorEmail);
    const impersonation = await auth.api.impersonateUser({
      headers: operatorSession,
      body: { userId: memberId },
      returnHeaders: true,
    });

    expect(impersonation.response.user.id).toBe(memberId);
    const impersonatedHeaders = new Headers({ cookie: cookieHeader(impersonation.headers) });

    const { requireSession } = await import("@/lib/auth/functions");
    const { ImpersonationReadOnlyError } = await import("@/lib/server-fn-error");
    const impersonatedSession = await auth.api.getSession({ headers: impersonatedHeaders });
    expect(impersonatedSession?.user.id).toBe(memberId);
    expect(impersonatedSession?.session).toMatchObject({ impersonatedBy: operatorId });

    // One guard covers every mutation in the app, because they all authenticate here.
    expect(() => requireSession(impersonatedSession)).toThrow(ImpersonationReadOnlyError);

    const stop = await auth.api.stopImpersonating({
      headers: impersonatedHeaders,
      returnHeaders: true,
    });
    expect(stop.response.user.id).toBe(operatorId);

    const restored = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader(stop.headers) }),
    });
    expect(restored?.user.id).toBe(operatorId);
    expect(restored?.session).not.toMatchObject({ impersonatedBy: expect.anything() });
  });

  it("refuses an operator account as an impersonation target", async () => {
    await expect(
      auth.api.impersonateUser({
        headers: await signIn(operatorEmail),
        body: { userId: operatorId },
      }),
    ).rejects.toThrow();
  });

  it("restores a suspended account when the ban is lifted", async () => {
    const operatorSession = await signIn(operatorEmail);
    await auth.api.banUser({
      headers: operatorSession,
      body: { userId: memberId, banReason: "test" },
    });
    expect((await readBanRow(memberId)).banned).toBe(true);

    await auth.api.unbanUser({ headers: operatorSession, body: { userId: memberId } });
    const lifted = await readBanRow(memberId);
    expect(lifted).toEqual({ banned: false, banReason: null, banExpires: null });
    await expect(signIn(memberEmail)).resolves.toBeInstanceOf(Headers);
  });
});
