import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { hashPassword } from "better-auth/crypto";

type AuthApi = typeof import("./auth").auth;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

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

integrationDescribe("password session revocation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
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
      await sql.end({ timeout: 1 });
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
