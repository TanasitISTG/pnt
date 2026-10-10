import { createHmac } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { config as loadEnv } from "dotenv";

const MY_NOVEL_ORIGIN = "https://api-mynovel.co";
const REQUEST_TIMEOUT_MS = 20_000;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CHAPTER_NUMBER_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const DEFAULT_MY_NOVEL_SIGNING_KEY =
  "05f668830dd6d2bd01a775cfae8186ac78d0fe68c15d4a54027ccf99a843175d";

export interface PntChapterRow {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
  translatedContent: string | null;
}
export type MyNovelPublishStatus = "draft" | "published";

export interface MyNovelChapterBody {
  bookId: string;
  chapterTitle: string;
  chapterContent: string;
  chapterPrice: number;
  publishStatus: MyNovelPublishStatus;
  scheduledAt: "";
}

export interface PublishItem {
  pntChapterId: string;
  number: string;
  body: MyNovelChapterBody;
}

export interface MyNovelCredentials {
  token: string;
  signingKey: string;
}

interface CliOptions {
  dryRun: boolean;
  help: boolean;
}

interface OperatorInput {
  pntNovelId: string;
  from: string;
  to: string;
  myNovelBookId: string;
  chapterPrice: number;
  publishStatus: MyNovelPublishStatus;
}

interface MyNovelBook {
  bookId: string;
  bookName: string;
  category: string;
}

interface MyNovelChapter {
  chapterTitle: string;
}

interface MyNovelPreflight {
  bookName: string;
  existingChapterCount: number;
}

interface ClosableQueryClient {
  end(options?: { timeout?: number }): Promise<void>;
}

class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export class MyNovelRequestError extends Error {
  readonly status: number | null;
  readonly outcomeUnknown: boolean;

  constructor(message: string, options: { status?: number; outcomeUnknown?: boolean } = {}) {
    super(message);
    this.name = "MyNovelRequestError";
    this.status = options.status ?? null;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}

export class ChapterPublishError extends Error {
  readonly completedNumbers: string[];
  readonly failedNumber: string;
  readonly remainingNumbers: string[];
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    options: {
      completedNumbers: string[];
      failedNumber: string;
      remainingNumbers: string[];
      outcomeUnknown: boolean;
    },
  ) {
    super(message);
    this.name = "ChapterPublishError";
    this.completedNumbers = options.completedNumbers;
    this.failedNumber = options.failedNumber;
    this.remainingNumbers = options.remainingNumbers;
    this.outcomeUnknown = options.outcomeUnknown;
  }
}

function usage(): string {
  return `Usage: bun run publish:mynovel -- [--dry-run]

Creates MyNovel chapters from translated PNT chapters.

Interactive values:
  PNT novel ID
  Inclusive chapter range (from/to)
  MyNovel book ID
  Chapter price
  Publish status (draft/published, defaults to draft)
  MyNovel Authorization token (masked unless MYNOVEL_AUTH_TOKEN is set)

Options:
  --dry-run  Validate PNT data and MyNovel destination without creating chapters
  --help     Show this help

Environment:
  MYNOVEL_AUTH_TOKEN             Replacement MyNovel bearer token (optional)
  MYNOVEL_REQUEST_SIGNING_KEY    Override the observed MyNovel signing key (optional)

Created chapters use the selected publishStatus and title-only names.`;
}

function parseCliOptions(args: string[]): CliOptions {
  let dryRun = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return { dryRun, help };
}

function requireId(label: string, value: string): string {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`);
  }
  return normalized;
}

function requireChapterNumber(label: string, value: string): string {
  const normalized = value.trim();
  const numeric = Number(normalized);
  if (
    !CHAPTER_NUMBER_PATTERN.test(normalized) ||
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    numeric > 999_999.99
  ) {
    throw new Error(`${label} must be between 0 and 999999.99 with at most two decimals`);
  }
  return normalized;
}

function requireChapterPrice(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Chapter price must be a non-negative integer");
  }
  const price = Number(normalized);
  if (!Number.isSafeInteger(price)) {
    throw new Error("Chapter price must be a safe non-negative integer");
  }
  return price;
}
export function parsePublishStatus(value: string): MyNovelPublishStatus {
  const normalized = value.trim().toLowerCase() || "draft";
  if (normalized !== "draft" && normalized !== "published") {
    throw new Error('Publish status must be "draft" or "published"');
  }
  return normalized;
}

function normalizeToken(value: string): string {
  const token = value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw new Error("MyNovel Authorization token is required");
  return token;
}

function assertTokenNotExpired(token: string): void {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[1]) return;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as unknown;
  } catch {
    return;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "exp" in payload &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp) &&
    payload.exp * 1000 <= Date.now()
  ) {
    throw new Error("MyNovel Authorization token is expired; obtain a replacement token");
  }
}

async function askOperatorInput(): Promise<OperatorInput> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const pntNovelId = requireId("PNT novel ID", await readline.question("PNT novel ID: "));
    const from = requireChapterNumber("Range start", await readline.question("Chapter from: "));
    const to = requireChapterNumber("Range end", await readline.question("Chapter to: "));
    if (Number(from) > Number(to)) {
      throw new Error("Chapter range start must be less than or equal to range end");
    }
    const myNovelBookId = requireId(
      "MyNovel book ID",
      await readline.question("MyNovel book ID: "),
    );
    const chapterPrice = requireChapterPrice(await readline.question("Chapter price: "));
    const publishStatus = parsePublishStatus(
      await readline.question("Publish status (draft/published) [draft]: "),
    );
    return { pntNovelId, from, to, myNovelBookId, chapterPrice, publishStatus };
  } finally {
    readline.close();
  }
}

async function readMaskedSecret(label: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error(`Set MYNOVEL_AUTH_TOKEN because ${label} requires an interactive TTY`);
  }

  const wasRaw = stdin.isRaw ?? false;
  stdout.write(`${label}: `);
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";

      const cleanup = () => {
        stdin.off("data", onData);
      };
      const finish = (result: string) => {
        cleanup();
        stdout.write("\n");
        resolve(result);
      };
      const cancel = () => {
        cleanup();
        stdout.write("\n");
        reject(new CancelledError());
      };
      const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (text.startsWith("\u001b")) return;

        for (const character of text) {
          if (character === "\u0003") {
            cancel();
            return;
          }
          if (character === "\r" || character === "\n") {
            finish(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = [...value].slice(0, -1).join("");
            continue;
          }
          if (character.charCodeAt(0) >= 32) value += character;
        }
      };

      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(wasRaw);
    if (!wasRaw) stdin.pause();
  }
}

async function askForConfirmation(
  count: number,
  publishStatus: MyNovelPublishStatus,
): Promise<boolean> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await readline.question(
      `Type PUBLISH to create ${count} ${publishStatus} chapter(s): `,
    );
    return confirmation === "PUBLISH";
  } finally {
    readline.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toMyNovelChapterContent(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
    .join("");
}

export function preparePublishItems(
  rows: readonly PntChapterRow[],
  options: {
    bookId: string;
    chapterPrice: number;
    publishStatus: MyNovelPublishStatus;
  },
): PublishItem[] {
  if (rows.length === 0) throw new Error("No PNT chapters found in the selected range");

  const missingTranslation = rows
    .filter((row) => !row.translatedContent?.trim())
    .map((row) => row.number);
  if (missingTranslation.length > 0) {
    throw new Error(
      `Selected chapters missing translated content: ${missingTranslation.join(", ")}`,
    );
  }

  const orderedRows = rows.toSorted((left, right) => Number(left.number) - Number(right.number));
  const titleCounts = new Map<string, number>();
  const items = orderedRows.map((row) => {
    const chapterTitle = row.translatedTitle?.trim() || row.title.trim();
    if (!chapterTitle) throw new Error(`PNT chapter ${row.number} has no usable title`);
    titleCounts.set(chapterTitle, (titleCounts.get(chapterTitle) ?? 0) + 1);

    return {
      pntChapterId: row.id,
      number: row.number,
      body: {
        bookId: options.bookId,
        chapterTitle,
        chapterContent: toMyNovelChapterContent(row.translatedContent!),
        chapterPrice: options.chapterPrice,
        publishStatus: options.publishStatus,
        scheduledAt: "" as const,
      },
    };
  });

  const duplicateTitles = [...titleCounts].filter(([, count]) => count > 1).map(([title]) => title);
  if (duplicateTitles.length > 0) {
    throw new Error(
      `Selected chapters have duplicate generated titles: ${duplicateTitles.join(", ")}`,
    );
  }

  return items;
}

export function createMyNovelSignature(
  requestId: string,
  timestamp: string,
  pathname: string,
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(`${requestId}.${timestamp}.${pathname}`)
    .digest("hex");
}

function safeApiMessage(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string" &&
    body.message.trim()
  ) {
    return body.message.trim();
  }
  return null;
}

async function decodeResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function myNovelRequest<T>(
  pathname: string,
  init: RequestInit,
  credentials: MyNovelCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (!pathname.startsWith("/api/")) {
    throw new Error("MyNovel request pathname must start with /api/");
  }

  const requestId = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${credentials.token}`);
  headers.set("X-Request-Id", requestId);
  headers.set("X-Request-Timestamp", timestamp);
  headers.set(
    "X-Request-Signature",
    createMyNovelSignature(requestId, timestamp, pathname, credentials.signingKey),
  );
  if (init.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  const method = init.method?.toUpperCase() ?? "GET";
  let response: Response;
  try {
    response = await fetchImpl(`${MY_NOVEL_ORIGIN}${pathname}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network request failed";
    throw new MyNovelRequestError(`MyNovel ${method} failed before a response: ${reason}`, {
      outcomeUnknown: method === "POST",
    });
  }

  const body = await decodeResponse(response);
  if (!response.ok) {
    const message = (safeApiMessage(body) ?? response.statusText) || "request rejected";
    throw new MyNovelRequestError(`MyNovel API ${response.status}: ${message}`, {
      status: response.status,
    });
  }

  return body as T;
}

function isMyNovelBook(value: unknown): value is MyNovelBook {
  return (
    typeof value === "object" &&
    value !== null &&
    "bookId" in value &&
    typeof value.bookId === "string" &&
    "bookName" in value &&
    typeof value.bookName === "string" &&
    "category" in value &&
    typeof value.category === "string"
  );
}

function isMyNovelChapter(value: unknown): value is MyNovelChapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "chapterTitle" in value &&
    typeof value.chapterTitle === "string"
  );
}

export async function preflightMyNovelDestination(
  bookId: string,
  items: readonly PublishItem[],
  credentials: MyNovelCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<MyNovelPreflight> {
  const book = await myNovelRequest<unknown>(
    `/api/books/${bookId}/owner`,
    { method: "GET" },
    credentials,
    fetchImpl,
  );
  if (!isMyNovelBook(book)) throw new Error("MyNovel returned malformed book metadata");
  if (book.bookId !== bookId) throw new Error("MyNovel returned a different destination book");
  if (book.category !== "novel") throw new Error("MyNovel destination must be a novel");

  const remoteChapters = await myNovelRequest<unknown>(
    `/api/books/${bookId}/chapters/owner`,
    { method: "GET" },
    credentials,
    fetchImpl,
  );
  if (!Array.isArray(remoteChapters) || !remoteChapters.every(isMyNovelChapter)) {
    throw new Error("MyNovel returned a malformed chapter list");
  }

  const existingTitles = new Set(remoteChapters.map((chapter) => chapter.chapterTitle.trim()));
  const collisions = items
    .map((item) => item.body.chapterTitle)
    .filter((title) => existingTitles.has(title));
  if (collisions.length > 0) {
    throw new Error(`MyNovel already contains chapter title(s): ${collisions.join(", ")}`);
  }

  return { bookName: book.bookName, existingChapterCount: remoteChapters.length };
}

function returnedChapterId(body: unknown): string | null {
  return typeof body === "object" &&
    body !== null &&
    "chapterId" in body &&
    typeof body.chapterId === "string"
    ? body.chapterId
    : null;
}

export async function postChaptersSequentially(
  items: readonly PublishItem[],
  credentials: MyNovelCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const createdNumbers: string[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    try {
      const result = await myNovelRequest<unknown>(
        "/api/chapters",
        { method: "POST", body: JSON.stringify(item.body) },
        credentials,
        fetchImpl,
      );
      createdNumbers.push(item.number);
      const chapterId = returnedChapterId(result);
      console.log(
        `[${index + 1}/${items.length}] Created ${item.number}: ${item.body.chapterTitle}${chapterId ? ` -> ${chapterId}` : ""}`,
      );
    } catch (error) {
      const outcomeUnknown = error instanceof MyNovelRequestError && error.outcomeUnknown;
      const message = error instanceof Error ? error.message : "Unknown MyNovel publishing failure";
      throw new ChapterPublishError(message, {
        completedNumbers: [...createdNumbers],
        failedNumber: item.number,
        remainingNumbers: items.slice(index + 1).map((remaining) => remaining.number),
        outcomeUnknown,
      });
    }
  }

  return createdNumbers;
}

function printPreflightSummary(input: {
  pntNovelId: string;
  pntNovelTitle: string;
  myNovelBookId: string;
  myNovelBookName: string;
  from: string;
  to: string;
  chapterPrice: number;
  publishStatus: MyNovelPublishStatus;
  items: readonly PublishItem[];
}): void {
  console.log("\nPublication preview");
  console.log(`PNT novel: ${input.pntNovelTitle} (${input.pntNovelId})`);
  console.log(`MyNovel book: ${input.myNovelBookName} (${input.myNovelBookId})`);
  console.log(`Requested range: ${input.from}–${input.to}`);
  console.log(`Selected chapters: ${input.items.length}`);
  console.log(`Chapter numbers: ${input.items.map((item) => item.number).join(", ")}`);
  console.log(`Publish status: ${input.publishStatus}`);
  if (input.publishStatus === "published") {
    console.warn("Warning: a live run will make these chapters public immediately.");
  }
  console.log(`Chapter price: ${input.chapterPrice}`);
  console.log("Titles:");
  for (const item of input.items) console.log(`  ${item.number}: ${item.body.chapterTitle}`);
  console.log("");
}

function printPublishFailure(error: ChapterPublishError): void {
  console.error(`Publishing stopped at chapter ${error.failedNumber}: ${error.message}`);
  console.error(
    `Completed chapters: ${error.completedNumbers.length > 0 ? error.completedNumbers.join(", ") : "none"}`,
  );
  console.error(`Remaining chapters: ${error.remainingNumbers.join(", ") || "none"}`);
  if (error.outcomeUnknown) {
    console.error(
      "The remote outcome is unknown. Check MyNovel before rerunning; exact-title preflight is the duplicate guard.",
    );
  }
}

async function main(): Promise<void> {
  let queryClient: ClosableQueryClient | null = null;

  try {
    const cli = parseCliOptions(process.argv.slice(2));
    if (cli.help) {
      console.log(usage());
      return;
    }

    loadEnv({ path: ".env.local" });
    loadEnv();

    const operator = await askOperatorInput();
    const [{ db, queryClient: importedQueryClient }, { chapters, novels }, drizzle] =
      await Promise.all([
        import("../src/lib/db/index.ts"),
        import("../src/lib/db/schema/index.ts"),
        import("drizzle-orm"),
      ]);
    queryClient = importedQueryClient;

    const [novel] = await db
      .select({ id: novels.id, title: novels.title })
      .from(novels)
      .where(drizzle.eq(novels.id, operator.pntNovelId))
      .limit(1);
    if (!novel) throw new Error(`PNT novel not found: ${operator.pntNovelId}`);

    const rows = await db
      .select({
        id: chapters.id,
        number: chapters.number,
        title: chapters.title,
        translatedTitle: chapters.translatedTitle,
        translatedContent: chapters.translatedContent,
      })
      .from(chapters)
      .where(
        drizzle.and(
          drizzle.eq(chapters.novelId, operator.pntNovelId),
          drizzle.gte(chapters.number, operator.from),
          drizzle.lte(chapters.number, operator.to),
        ),
      )
      .orderBy(drizzle.asc(drizzle.sql`COALESCE(${chapters.number}::numeric, 0)`));

    const items = preparePublishItems(rows, {
      bookId: operator.myNovelBookId,
      chapterPrice: operator.chapterPrice,
      publishStatus: operator.publishStatus,
    });

    const token = normalizeToken(
      process.env.MYNOVEL_AUTH_TOKEN ?? (await readMaskedSecret("MyNovel Authorization token")),
    );
    assertTokenNotExpired(token);
    const credentials: MyNovelCredentials = {
      token,
      signingKey: process.env.MYNOVEL_REQUEST_SIGNING_KEY?.trim() || DEFAULT_MY_NOVEL_SIGNING_KEY,
    };

    const destination = await preflightMyNovelDestination(
      operator.myNovelBookId,
      items,
      credentials,
    );
    printPreflightSummary({
      pntNovelId: novel.id,
      pntNovelTitle: novel.title,
      myNovelBookId: operator.myNovelBookId,
      myNovelBookName: destination.bookName,
      from: operator.from,
      to: operator.to,
      chapterPrice: operator.chapterPrice,
      publishStatus: operator.publishStatus,
      items,
    });

    if (cli.dryRun) {
      console.log("Dry run complete; created 0 chapters.");
      return;
    }

    if (!(await askForConfirmation(items.length, operator.publishStatus))) {
      console.log("Cancelled; created 0 chapters.");
      return;
    }

    const created = await postChaptersSequentially(items, credentials);
    console.log(`Created ${created.length} ${operator.publishStatus} chapter(s).`);
  } catch (error) {
    if (error instanceof CancelledError) {
      console.error("Cancelled.");
      process.exitCode = 130;
    } else if (error instanceof ChapterPublishError) {
      printPublishFailure(error);
      process.exitCode = 1;
    } else {
      console.error(error instanceof Error ? error.message : "Unknown publisher failure");
      process.exitCode = 1;
    }
  } finally {
    if (queryClient) await queryClient.end({ timeout: 1 });
  }
}

if (import.meta.main) await main();
