import { describe, expect, it } from "vitest";

import { findEnglishLiterals, findEnglishTextNodes, findLiteralAttributes } from "./i18n-scan";

/**
 * The scanner's two answers, held to the cases that made it exist.
 *
 * The first version of this check was a regular expression and reported type annotations as
 * English, which is why every case below is about *not* reporting something: a check that cries
 * wolf is one a reviewer learns to skip.
 */

describe("findEnglishTextNodes", () => {
  it("reports a JSX text node that reads as prose, with its line", () => {
    const source = [
      "export function TermsPage() {",
      "  return (",
      "    <section>",
      "      <p>Nothing is published at this address.</p>",
      "    </section>",
      "  );",
      "}",
    ].join("\n");

    expect(findEnglishTextNodes("terms.tsx", source)).toEqual([
      { text: "Nothing is published at this address.", line: 4 },
    ]);
  });

  it("collapses the whitespace a wrapped element leaves in the text", () => {
    const source = [
      "export function Page() {",
      "  return (",
      "    <p>",
      "      Every account owns its own novels, chapters and",
      "      glossary.",
      "    </p>",
      "  );",
      "}",
    ].join("\n");

    const [found] = findEnglishTextNodes("page.tsx", source);
    expect(found?.text).toBe("Every account owns its own novels, chapters and glossary.");
  });

  it("ignores an expression, which is how translated copy reaches a page", () => {
    const source = [
      "export function Page() {",
      '  return <p>{t("privacy.ownership")}</p>;',
      "}",
    ].join("\n");

    expect(findEnglishTextNodes("page.tsx", source)).toEqual([]);
  });

  it("ignores Thai text, which is a text node a translator already wrote", () => {
    const source = ["export function Page() {", "  return <p>ทุกบัญชีมีคลังนิยายของตัวเอง</p>;", "}"].join(
      "\n",
    );

    expect(findEnglishTextNodes("page.tsx", source)).toEqual([]);
  });

  it("ignores a fragment too short to be a sentence", () => {
    const source = [
      "export function Page() {",
      "  return (",
      "    <div>",
      "      <span>2 MB</span>",
      "      <span>EPUB</span>",
      "      <span>Rows</span>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");

    expect(findEnglishTextNodes("page.tsx", source)).toEqual([]);
  });

  it("does not read code as copy", () => {
    const source = [
      "export async function load(): Promise<void> {",
      "  switch (status) {",
      '    case "queued":',
      "      return (",
      "        <div>done</div>",
      "      );",
      "  }",
      "}",
    ].join("\n");

    // `done` is one word; the type annotation, the case label and the keywords are not text nodes.
    expect(findEnglishTextNodes("load.tsx", source)).toEqual([]);
  });

  it("reports every node it finds, in source order", () => {
    const source = [
      "export function Page() {",
      "  return (",
      "    <div>",
      "      <h1>Terms of Service</h1>",
      "      <p>{version}</p>",
      "      <p>Terms governing access to the service.</p>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");

    expect(findEnglishTextNodes("page.tsx", source)).toEqual([
      { text: "Terms of Service", line: 4 },
      { text: "Terms governing access to the service.", line: 6 },
    ]);
  });

  it("refuses a file it cannot parse rather than guessing at its text", () => {
    expect(() => findEnglishTextNodes("broken.tsx", "return <p>unclosed")).toThrow(
      /broken\.tsx could not be parsed/,
    );
  });
});

describe("findLiteralAttributes", () => {
  it("reports a literal aria-label, which no catalog ever sees", () => {
    const source = [
      "export function Loader() {",
      '  return <Spinner aria-label="Loading" />;',
      "}",
    ].join("\n");

    expect(findLiteralAttributes("loader.tsx", source)).toEqual([
      { text: "Loading", line: 2, attribute: "aria-label" },
    ]);
  });

  it("reports a literal hint and a literal alt, with each attribute named", () => {
    const source = [
      "export function Field() {",
      '  return <input placeholder="Search novels" />;',
      "}",
      "export function Cover() {",
      '  return <img alt="Cover" />;',
      "}",
    ].join("\n");

    expect(findLiteralAttributes("field.tsx", source)).toEqual([
      { text: "Search novels", line: 2, attribute: "placeholder" },
      { text: "Cover", line: 5, attribute: "alt" },
    ]);
  });

  it("ignores an expression, which is a translated label", () => {
    const source = [
      "export function Loader() {",
      '  return <Spinner aria-label={t("common.loading")} />;',
      "}",
    ].join("\n");

    expect(findLiteralAttributes("loader.tsx", source)).toEqual([]);
  });

  it("ignores an attribute whose value a reader never hears", () => {
    const source = [
      "export function Card() {",
      '  return <div className="rounded-lg" data-testid="card" role="region" />;',
      "}",
    ].join("\n");

    expect(findLiteralAttributes("card.tsx", source)).toEqual([]);
  });

  it("ignores an empty literal, which renders nothing to translate", () => {
    const source = [
      "export function Field() {",
      '  return <input placeholder="   " aria-label="" />;',
      "}",
    ].join("\n");

    expect(findLiteralAttributes("field.tsx", source)).toEqual([]);
  });
});

describe("findEnglishLiterals", () => {
  it("reports the message of a rule written in a module, with its line", () => {
    const source = [
      "export const profileNameSchema = z",
      "  .object({",
      '    name: z.string().min(1, "Display name is required"),',
      "  });",
    ].join("\n");

    expect(findEnglishLiterals("profile/schemas.ts", source)).toEqual([
      { text: "Display name is required", line: 3 },
    ]);
  });

  it("reports a template literal, read as the sentence its fixed parts make", () => {
    const source = [
      "export function message(max: number): string {",
      "  return `Display name must be at most ${max} characters`;",
      "}",
    ].join("\n");

    expect(findEnglishLiterals("profile/schemas.ts", source)).toEqual([
      { text: "Display name must be at most characters", line: 2 },
    ]);
  });

  it("does not read a utility class list as a sentence", () => {
    const source = [
      'export const rowClass = "flex items-center justify-between gap-3";',
      'export const fieldId = "chapter-range-to-error";',
      'export const modulePath = "@/components/ui/table";',
    ].join("\n");

    expect(findEnglishLiterals("row.ts", source)).toEqual([]);
  });

  it("does not read a diagnostic as copy, in any of the shapes it is written in", () => {
    const source = [
      "function load(): void {",
      '  console.warn("the provider key is missing, so nothing will be sent");',
      '  log("warn", "email throttled for the recipient", {});',
      '  throw new Error("avatar cleanup after account deletion failed");',
      "}",
    ].join("\n");

    expect(findEnglishLiterals("load.ts", source)).toEqual([]);
  });

  it("does not read an error class's own message as copy, whichever half holds it", () => {
    const source = [
      "export class HostResolutionError extends Error {",
      '  constructor(code: "DNS_TIMEOUT" | "DNS_FAILED") {',
      "    super(",
      '      code === "DNS_TIMEOUT" ? "Hostname lookup timed out" : "Hostname could not be resolved",',
      "    );",
      "  }",
      "}",
      'export const failure = new StorageKeyError(key, "Unsafe storage key: the vocabulary refuses it");',
    ].join("\n");

    expect(findEnglishLiterals("network-policy.server.ts", source)).toEqual([]);
  });

  it("does not read a statement for the database as a sentence", () => {
    const source = [
      "const schema = sql`CREATE SCHEMA IF NOT EXISTS drizzle`;",
      'const counted = "SELECT count(*)::int FROM epub_uploads WHERE object_key IS NULL";',
      "await db.execute(schema);",
      "console.log(counted);",
    ].join("\n");

    expect(findEnglishLiterals("migrate.ts", source)).toEqual([]);
  });

  it("does not read a pattern or a document as a sentence", () => {
    const source = [
      'const pattern = new RegExp("unsupported|not supported|does not support");',
      "const html = '<p style=\"margin: 24px 0\">Every account keeps its own workspace.</p>';",
      "console.log(pattern, html);",
    ].join("\n");

    expect(findEnglishLiterals("template.ts", source)).toEqual([]);
  });

  it("reports a toast's label however short it is, because a toast is read by a reader", () => {
    const source = [
      "export function report(): void {",
      '  toast.error("Export failed");',
      '  toast.error(t("studio.exportFailed"));',
      "  toast.success(`Saved ${count} chapters`);",
      "}",
    ].join("\n");

    expect(findEnglishLiterals("use-export.ts", source)).toEqual([
      { text: "Export failed", line: 2 },
      { text: "Saved chapters", line: 4 },
    ]);
  });

  it("reports a sentence handed to a surface that shows it, and not Thai", () => {
    const source = [
      "export async function act(): Promise<void> {",
      '  throw new SafeServerError("Chapter not found or unauthorized");',
      '  throw new SafeServerError(encodeMessage("errors.chapterNotFound"));',
      '  throw new SafeServerError("ไม่พบบทนี้");',
      "}",
    ].join("\n");

    expect(findEnglishLiterals("mutations.ts", source)).toEqual([
      { text: "Chapter not found or unauthorized", line: 2 },
    ]);
  });

  it("reports every literal it finds, in source order", () => {
    const source = [
      "export const messages = {",
      '  first: "Tell us what is wrong so an operator can act on it",',
      '  second: "A decision can be appealed by writing to the site operator",',
      "};",
    ].join("\n");

    expect(findEnglishLiterals("messages.ts", source)).toEqual([
      { text: "Tell us what is wrong so an operator can act on it", line: 2 },
      { text: "A decision can be appealed by writing to the site operator", line: 3 },
    ]);
  });
});
