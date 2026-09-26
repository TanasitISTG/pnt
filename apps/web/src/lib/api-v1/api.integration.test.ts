import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { hashPassword } from "better-auth/crypto";
import postgres, { type Sql } from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
let sql: Sql;
let app: ChildProcess | undefined;
let baseUrl: string;
let cookie: string;
let otherCookie: string;
const userId = `api-user-${randomUUID()}`;
const otherUserId = `api-user-${randomUUID()}`;
const novelId = `api-novel-${randomUUID()}`;
const emptyId = `api-empty-${randomUUID()}`;
const draftId = `api-draft-${randomUUID()}`;
const chapterA = `api-chapter-${randomUUID()}`;
const chapterB = `api-chapter-${randomUUID()}`;
const draftChapter = `api-chapter-${randomUUID()}`;
const guestIp = "203.0.113.62";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function request(
  path: string,
  init: RequestInit = {},
  authenticated: boolean | "other" = false,
) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "x-forwarded-for": guestIp,
      ...(authenticated ? { Cookie: authenticated === "other" ? otherCookie : cookie } : {}),
      ...(init.method && init.method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function ready() {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (app?.exitCode !== null) throw new Error(`v1 HTTP server exited (${app?.exitCode})`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* Vite startup takes time. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("v1 HTTP server did not start");
}

integrationDescribe("v1 HTTP routes (disposable PostgreSQL)", () => {
  beforeAll(async () => {
    const name = new URL(databaseUrl!).pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(name) || !/(^|_)(test|integration|e2e)(_|$)/.test(name))
      throw new Error("v1 integration requires a disposable test/integration/e2e database");
    sql = postgres(databaseUrl!, { max: 3, onnotice: () => {} });
    await sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES
      (${userId}, 'API Reader', ${`${userId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other API Reader', ${`${otherUserId}@example.test`}, true, now(), now())
    `;
    const passwordHash = await hashPassword("test-password-123");
    await sql`
      INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at")
      VALUES
      (${`account-${userId}`}, ${userId}, 'credential', ${userId}, ${passwordHash}, now(), now()),
      (${`account-${otherUserId}`}, ${otherUserId}, 'credential', ${otherUserId}, ${passwordHash}, now(), now())
    `;
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 200, g: 150, b: 100, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await sql`
      INSERT INTO novels (id, user_id, title, source_lang, target_lang, story_summary, published_at, cover, cover_mime, created_at, updated_at)
      VALUES
      (${novelId}, ${userId}, 'Live API', 'en', 'th', 'secret summary', now() - interval '1 day', ${png}, 'image/png', now(), now()),
      (${emptyId}, ${userId}, 'Empty API', 'en', 'th', '', now() - interval '1 day', NULL, NULL, now(), now()),
      (${draftId}, ${userId}, 'Draft API', 'en', 'th', '', NULL, ${png}, 'image/png', now(), now())
    `;
    await sql`
      INSERT INTO chapters (id, novel_id, number, title, raw_content, translated_content, status, raw_char_count, source_revision, translation_generation, published_at, created_at, updated_at)
      VALUES
      (${chapterA}, ${novelId}, 1.25, 'One', 'Raw one', 'Translated one', 'translated', 7, 1, 0, now() - interval '1 day', now(), now()),
      (${chapterB}, ${novelId}, 2, 'Two', 'Raw two', 'Translated two', 'translated', 7, 1, 0, now() - interval '1 day', now(), now()),
      (${draftChapter}, ${draftId}, 1, 'Draft', 'Hidden raw', NULL, 'raw', 10, 1, 0, NULL, now(), now())
    `;

    if (process.env.E2E_APP_URL) {
      baseUrl = process.env.E2E_APP_URL;
    } else {
      const port = await freePort();
      baseUrl = `http://127.0.0.1:${port}`;
      app = spawn(
        "bun",
        ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port)],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DATABASE_URL: databaseUrl!,
            BETTER_AUTH_URL: baseUrl,
            BETTER_AUTH_SECRET: "test-api-secret-at-least-thirty-two-bytes",
            APP_ENCRYPTION_KEY: "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=",
            RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
            INNGEST_DEV: "1",
          },
          stdio: "ignore",
        },
      );
      await ready();
    }
    const login = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${userId}@example.test`, password: "test-password-123" }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    const otherLogin = await request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: `${otherUserId}@example.test`, password: "test-password-123" }),
    });
    expect(otherLogin.status).toBe(200);
    otherCookie = otherLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(otherCookie).not.toBe("");
  }, 120_000);

  afterAll(async () => {
    if (app?.pid) {
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(app.pid), "/T", "/F"]);
      else app.kill();
    }
    if (sql) {
      await sql`DELETE FROM "user" WHERE id IN (${userId}, ${otherUserId})`;
      await sql`DELETE FROM rate_limits WHERE key = ${`read:${guestIp}`} OR key = ${`covers:${guestIp}`}`;
      await sql.end({ timeout: 1 });
    }
  });

  it("projects only live novels, manifest metadata and distinct chapter body", async () => {
    const list = await request("/api/v1/novels");
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("no-store");
    const novels = await list.json();
    expect(novels.find((row: { id: string }) => row.id === draftId)).toBeUndefined();
    expect(novels.find((row: { id: string }) => row.id === novelId).hasCover).toBe(true);
    expect(await (await request(`/api/v1/novels/${emptyId}/manifest`)).json()).toEqual([]);
    const manifest = await (await request(`/api/v1/novels/${novelId}/manifest`)).json();
    expect(manifest[0]).toEqual({
      id: chapterA,
      number: "1.25",
      title: "One",
      translatedTitle: null,
    });
    const body = await (await request(`/api/v1/novels/${novelId}/chapters/${chapterA}`)).json();
    expect(body.rawContent).toBe("Raw one");
    expect(body.translatedContent).toBe("Translated one");
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("publishedAt");
  });

  it("enforces guest 404 and owner draft visibility, including covers", async () => {
    expect((await request(`/api/v1/novels/${draftId}`)).status).toBe(404);
    expect((await request(`/api/v1/novels/${draftId}/cover?w=320`)).status).toBe(404);
    expect((await request(`/api/v1/novels/${draftId}/chapters/${draftChapter}`)).status).toBe(404);
    expect((await request(`/api/v1/novels/${novelId}/chapters/${draftChapter}`)).status).toBe(404);
    expect((await request(`/api/v1/novels/missing/manifest`)).status).toBe(404);
    expect((await request(`/api/v1/novels/${draftId}`, {}, true)).status).toBe(200);
    expect(
      (await request(`/api/v1/novels/${draftId}/chapters/${draftChapter}`, {}, true)).status,
    ).toBe(200);
    const ownerCover = await request(`/api/v1/novels/${draftId}/cover?w=320`, {}, true);
    expect(ownerCover.status).toBe(200);
    expect(ownerCover.headers.get("cache-control")).toBe("no-store");
    expect((await request(`/api/v1/novels/${novelId}/cover?w=999`)).status).toBe(400);
  });

  it("returns 401, 400, 404 and duplicate bookmark semantics over HTTP", async () => {
    const statePath = `/api/v1/novels/${novelId}/reader-state`;
    expect((await request(statePath)).status).toBe(401);
    expect((await request(`/api/v1/novels/${novelId}/bookmarks?cursorId=x`, {}, true)).status).toBe(
      400,
    );
    expect(
      (await request(`/api/v1/novels/${novelId}/bookmarks?cursorId=x&cursorId=y`, {}, true)).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/api/v1/novels/${novelId}/bookmarks?cursorCreatedAt=2026-02-31%2012%3A13%3A14&cursorId=x`,
          {},
          true,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/api/v1/novels/${novelId}/chapters/${chapterA}/position`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scrollFraction: 1.2 }),
          },
          true,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/api/v1/novels/${novelId}/chapters/${draftChapter}/open`,
          { method: "POST" },
          true,
        )
      ).status,
    ).toBe(404);
    const path = `/api/v1/novels/${novelId}/bookmarks`;
    const validCursor = new URLSearchParams({
      cursorCreatedAt: "2026-01-01 00:00:00.123456",
      cursorId: "sentinel",
    });
    expect((await request(`${path}?${validCursor}`, {}, true)).status).toBe(200);
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId: chapterA,
        paragraphIndex: 0,
        column: "translated",
        excerpt: "Translated one",
      }),
    };
    const first = await request(path, init, true);
    expect(first.status).toBe(201);
    const created = await first.json();
    const duplicate = await request(path, init, true);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ id: created.id, duplicate: true });
    expect(
      (
        await request(
          `/api/v1/bookmarks/${created.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: "Saved" }),
          },
          true,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(`/api/v1/bookmarks/${created.id}`, { method: "DELETE" }, true)).status,
    ).toBe(200);
  });

  it("returns 404 for another signed-in user's novel, chapter and bookmark", async () => {
    const novelPath = `/api/v1/novels/${novelId}`;
    expect((await request(novelPath, {}, "other")).status).toBe(404);
    expect((await request(`${novelPath}/manifest`, {}, "other")).status).toBe(404);
    expect((await request(`${novelPath}/cover?w=320`, {}, "other")).status).toBe(404);
    expect((await request(`${novelPath}/chapters/${chapterA}`, {}, "other")).status).toBe(404);
    expect((await request(`${novelPath}/reader-state`, {}, "other")).status).toBe(404);
    expect((await request(`${novelPath}/bookmarks`, {}, "other")).status).toBe(404);
    expect(
      (await request(`${novelPath}/chapters/${chapterA}/open`, { method: "POST" }, "other")).status,
    ).toBe(404);

    const created = await request(
      `${novelPath}/bookmarks`,
      {
        method: "POST",
        body: JSON.stringify({
          chapterId: chapterA,
          paragraphIndex: 3,
          column: null,
          excerpt: "Owned spot",
        }),
      },
      true,
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect(
      (
        await request(
          `/api/v1/bookmarks/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ note: "Not yours" }),
          },
          "other",
        )
      ).status,
    ).toBe(404);
    expect((await request(`/api/v1/bookmarks/${id}`, { method: "DELETE" }, "other")).status).toBe(
      404,
    );
    expect((await request(`/api/v1/bookmarks/${id}`, { method: "DELETE" }, true)).status).toBe(200);
  });

  it("round-trips an emitted microsecond cursor over the 200-item HTTP page boundary", async () => {
    await sql`
      INSERT INTO reader_bookmarks (
        id, user_id, novel_id, chapter_id, paragraph_index, source_column, excerpt, note, created_at
      )
      SELECT ${chapterA} || '-page-' || lpad(series::text, 4, '0'), ${userId}, ${novelId}, ${chapterA},
        series, NULL, 'excerpt ' || series, NULL, TIMESTAMP '2026-01-01 00:00:00.123456'
      FROM generate_series(0, 200) AS series
    `;
    const path = `/api/v1/novels/${novelId}/bookmarks`;
    const first = await (await request(path, {}, true)).json();
    expect(first.bookmarks).toHaveLength(200);
    expect(first.nextCursor.createdAt).toBe("2026-01-01 00:00:00.123456");
    const query = new URLSearchParams({
      cursorCreatedAt: first.nextCursor.createdAt,
      cursorId: first.nextCursor.id,
    });
    const second = await (await request(`${path}?${query}`, {}, true)).json();
    expect(second.bookmarks).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.bookmarks, ...second.bookmarks].map((row: { id: string }) => row.id);
    expect(new Set(ids).size).toBe(201);
    const state = await (await request(`/api/v1/novels/${novelId}/reader-state`, {}, true)).json();
    expect(state.bookmarks).toHaveLength(200);
    expect(state.bookmarkNextCursor).toEqual(first.nextCursor);
  });

  it("rejects cross-origin and form-compatible cookie-authenticated writes", async () => {
    const path = `/api/v1/novels/${novelId}/chapters/${chapterA}/open`;
    const hostile = await request(
      path,
      { method: "POST", headers: { Origin: "https://attacker.example.test" } },
      true,
    );
    expect(hostile.status).toBe(400);
    expect(await hostile.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request" },
    });
    expect(
      (await request(path, { method: "POST", headers: { "Content-Type": "text/plain" } }, true))
        .status,
    ).toBe(400);
    const state = await (await request(`/api/v1/novels/${novelId}/reader-state`, {}, true)).json();
    expect(state.lastChapterId).toBeNull();
  });

  it("drops delayed chapter A position after chapter B opens", async () => {
    const path = (id: string) => `/api/v1/novels/${novelId}/chapters/${id}`;
    expect(
      (
        await request(
          `${path(chapterA)}/open`,
          { method: "POST", headers: { Origin: baseUrl } },
          true,
        )
      ).status,
    ).toBe(200);
    expect((await request(`${path(chapterB)}/open`, { method: "POST" }, true)).status).toBe(200);
    expect(
      (
        await request(
          `${path(chapterA)}/position`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scrollFraction: 0.8 }),
          },
          true,
        )
      ).status,
    ).toBe(200);
    const state = await (await request(`/api/v1/novels/${novelId}/reader-state`, {}, true)).json();
    expect(state.lastChapterId).toBe(chapterB);
    expect(state.scrollFraction).toBe(0);
  });

  it("maps the guest rate limit to 429 JSON without a TanStack response context", async () => {
    await sql`
      INSERT INTO rate_limits (key, count, reset_at) VALUES (${`read:${guestIp}`}, 60, now() + interval '1 minute')
      ON CONFLICT (key) DO UPDATE SET count = 60, reset_at = now() + interval '1 minute'
    `;
    const response = await request("/api/v1/novels");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });
});
