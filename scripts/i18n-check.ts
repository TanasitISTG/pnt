/**
 * Catalog checks, run by `bun run i18n:check` and in CI.
 *
 * Four questions, three of them fatal:
 *
 * 1. Is a key in one catalog and not the other? (`satisfies` already fails the typecheck on
 *    this, but the check reports it in the same place as everything else.)
 * 2. Is a value empty or whitespace-only?
 * 3. Is a Thai value byte-identical to its English source, which is how a forgotten string
 *    looks — with an explicit allowlist for the handful of values that are the same in both
 *    languages because they are proper nouns.
 * 4. Are placeholders, plural branches or rich-text tags unbalanced between the two
 *    languages? A message that a surface renders with `t.rich` carries its link in a tag,
 *    so a Thai sentence that drops `<terms>` would throw where the English one renders.
 *
 * A key defined but never referenced anywhere in `src/` is reported and does not fail the
 * run: a key can be added one commit before the screen that reads it is written, and a
 * stale key is noise rather than a bug.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import en from "../src/lib/i18n/messages/en";
import th from "../src/lib/i18n/messages/th";

/** Values that are the same in both languages on purpose. */
const IDENTICAL_ALLOWED = new Set([
  // The brand and the site name are names, not sentences.
  "shell.brand",
  "meta.siteName",
  "shell.footerCopyright",
  // An email address and a password mask are not words in any language.
  "auth.emailPlaceholder",
  "auth.passwordPlaceholder",
]);

type Catalog = Record<string, unknown>;

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value !== "object" || value === null) return result;
  for (const [key, entry] of Object.entries(value as Catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") result.set(path, entry);
    else for (const [nested, nestedValue] of flatten(entry, path)) result.set(nested, nestedValue);
  }
  return result;
}

/**
 * The identifiers a message interpolates.
 *
 * A hand-rolled scan of the first word after `{` is enough for what this checks: a plural
 * branch contributes its own argument (`{count, plural, ...}`) and `#` is not an identifier,
 * so the sets are comparable between the two languages even though Thai never branches.
 */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return found;
}

/**
 * The rich-text tag names a message uses, whether it is the opening or the closing form.
 *
 * Both catalogs have to name the same tags, because the call site supplies one function per
 * tag: a translation that renamed `<policy>` would render its link's inner text with no link
 * around it, or throw.
 */
function tagNames(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/<\s*\/?\s*([A-Za-z][A-Za-z0-9_]*)\s*>/g)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return found;
}

/** Whether every tag a message opens is closed, in order. */
function tagsBalanced(message: string): boolean {
  const stack: string[] = [];
  for (const match of message.matchAll(/<\s*(\/?)\s*([A-Za-z][A-Za-z0-9_]*)\s*>/g)) {
    const name = match[2];
    if (!name) continue;
    if (match[1] === "/") {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function braceBalanced(message: string): boolean {
  let depth = 0;
  for (const character of message) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Every `.ts`/`.tsx` file under `src/`, for the orphan-key sweep. */
function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
  }
  return files;
}

const enKeys = flatten(en);
const thKeys = flatten(th);
const failures: string[] = [];
const notes: string[] = [];

const missing = [...enKeys.keys()].filter((key) => !thKeys.has(key));
const extra = [...thKeys.keys()].filter((key) => !enKeys.has(key));
if (missing.length > 0)
  failures.push(`Thai catalog is missing ${missing.length}: ${missing.join(", ")}`);
if (extra.length > 0)
  failures.push(`Thai catalog has ${extra.length} unknown: ${extra.join(", ")}`);

const empty = [...enKeys.entries(), ...thKeys.entries()]
  .filter(([, value]) => value.trim() === "")
  .map(([key]) => key);
if (empty.length > 0) failures.push(`Empty values: ${empty.join(", ")}`);

const leftover = [...thKeys.entries()]
  .filter(([key, value]) => enKeys.get(key) === value && !IDENTICAL_ALLOWED.has(key))
  .map(([key]) => key);
if (leftover.length > 0) {
  failures.push(`Thai text is still the English text: ${leftover.join(", ")}`);
}

const unbalanced: string[] = [];
for (const [key, english] of enKeys) {
  const thai = thKeys.get(key);
  if (thai === undefined) continue;
  const enPlaceholders = placeholders(english);
  const thPlaceholders = placeholders(thai);
  const difference = [
    ...[...enPlaceholders].filter((name) => !thPlaceholders.has(name)),
    ...[...thPlaceholders].filter((name) => !enPlaceholders.has(name)),
  ];
  if (difference.length > 0) {
    unbalanced.push(`${key} (${difference.join(", ")})`);
    continue;
  }
  const englishTags = tagNames(english);
  const thaiTags = tagNames(thai);
  const tagDifference = [
    ...[...englishTags].filter((name) => !thaiTags.has(name)),
    ...[...thaiTags].filter((name) => !englishTags.has(name)),
  ];
  if (tagDifference.length > 0) {
    unbalanced.push(`${key} (tags: ${tagDifference.join(", ")})`);
    continue;
  }
  if (!braceBalanced(thai)) unbalanced.push(`${key} (unbalanced braces)`);
  else if (!tagsBalanced(thai)) unbalanced.push(`${key} (unbalanced tags)`);
}
if (unbalanced.length > 0)
  failures.push(`Placeholders differ between languages: ${unbalanced.join("; ")}`);

// A key is "referenced" when its own name, or its full dotted path, appears as a string
// literal anywhere in `src/`. Both spellings matter: a component passes the leaf name
// (`t("title")`), while server copy carries the whole key so a code can be resolved without a
// namespace (`encodeMessage("errors.chapterNotFound")`).
const source = sourceFiles("src")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const orphans = [...enKeys.keys()].filter((key) => {
  const name = key.split(".").pop() ?? key;
  return (
    !source.includes(`"${name}"`) &&
    !source.includes(`'${name}'`) &&
    !source.includes(`"${key}"`) &&
    !source.includes(`'${key}'`)
  );
});
if (orphans.length > 0) notes.push(`Never referenced: ${orphans.join(", ")}`);

console.log(`i18n: ${enKeys.size} keys in ${new Set([...enKeys.keys(), ...thKeys.keys()]).size}`);
if (notes.length > 0) for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("i18n: catalogs agree");
