import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";
import { hashPassword } from "better-auth/crypto";
import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

type AuthApi = typeof import("./auth").auth;

let sql: Sql;
let auth: AuthApi;
let userId: string;
let email: string;

function sessionCookie(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie")?.split(/,(?=\s*(?:__Secure-)?better-auth\.session_token=)/) ??
        []);
  const cookie = setCookies.find((value) =>
    /^(?:__Secure-)?better-auth\.session_token=/.test(value),
  );
  if (!cookie) throw new Error("Better Auth did not return a session cookie");
  return cookie.split(";", 1)[0]!;
}

async function signIn(password: string): Promise<Headers> {
  const result = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: process.env.BETTER_AUTH_URL! }),
    returnHeaders: true,
  });
  return new Headers({ cookie: sessionCookie(result.headers) });
}

describeIntegration("password session revocation", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 10 }));
    ({ auth } = await import("./auth"));

    userId = `auth-user-${randomUUID()}`;
    email = `${userId}@example.test`;
    const now = new Date();
    await sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES (${userId}, 'Password Test User', ${email}, true, ${now}, ${now})
    `;
    await sql`
      INSERT INTO "account" (
        "id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}, ${userId}, 'credential', ${userId}, ${await hashPassword("initial-password")}, ${now}, ${now}
      )
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM "user" WHERE "id" = ${userId}`;
      await closeIntegrationDatabase();
    }
  });

  it("keeps the changing session active and revokes the other session", async () => {
    const changingSession = await signIn("initial-password");
    const otherSession = await signIn("initial-password");

    await expect(auth.api.getSession({ headers: changingSession })).resolves.not.toBeNull();
    await expect(auth.api.getSession({ headers: otherSession })).resolves.not.toBeNull();

    const result = await auth.api.changePassword({
      headers: changingSession,
      body: {
        currentPassword: "initial-password",
        newPassword: "updated-password",
        revokeOtherSessions: true,
      },
      returnHeaders: true,
    });
    const refreshedChangingSession = new Headers({ cookie: sessionCookie(result.headers) });

    await expect(
      auth.api.getSession({ headers: refreshedChangingSession }),
    ).resolves.not.toBeNull();
    await expect(auth.api.getSession({ headers: changingSession })).resolves.toBeNull();
    await expect(auth.api.getSession({ headers: otherSession })).resolves.toBeNull();
    await expect(signIn("updated-password")).resolves.toBeDefined();
  }, 30_000);
});
