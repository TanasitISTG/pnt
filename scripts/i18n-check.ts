/**
 * Catalog checks, run by `bun run i18n:check` and in CI.
 *
 * Eight questions, seven of them fatal:
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
 * 5. Does a Thai value use a word §5 of `i18n.md` rules out — the synonym the glossary
 *    rejects, a polite particle, an apology, an exclamation mark? The catalog is written by
 *    hand in one language, so the one thing a reviewer cannot see is a second word for a
 *    concept the glossary already fixed.
 * 6. Does a key-shaped string literal in `src/` name a key no catalog defines? A message no
 *    catalog resolves is passed through unchanged, so a typo reaches the reader as the key
 *    itself.
 * 7. Is copy sitting in a JSX text node or in an `aria-label`/`placeholder`/`title`/`alt`
 *    literal, where no catalog is involved at all? A page whose whole body was English JSX
 *    shipped once because questions 1-6 cannot see it.
 * 8. Is English sitting in a plain string literal anywhere in `src/` or `scripts/`, which is
 *    where a `.ts` module keeps the copy no catalog reaches — a Zod rule's message, a toast, a
 *    sentence stored for a surface to render later? Question 7 reads two of the three shapes
 *    copy hides in; this one reads the third, and adds the one place a reader sees text that is
 *    not a catalog entry at all.
 *
 * A key defined but never referenced anywhere in `src/` is reported and does not fail the
 * run: a key can be added one commit before the screen that reads it is written, and a
 * stale key is noise rather than a bug.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import en from "../src/lib/i18n/messages/en";
import th from "../src/lib/i18n/messages/th";
import { findEnglishLiterals, findEnglishTextNodes, findLiteralAttributes } from "./i18n-scan";

/**
 * Values that are the same in both languages on purpose: a name, an address, a mask, or a
 * message that is structure only and takes every word it says from its parameters.
 */
const IDENTICAL_ALLOWED = new Set([
  // The brand and the site name are names, not sentences.
  "shell.brand",
  "meta.siteName",
  "shell.footerCopyright",
  // An email address and a password mask are not words in any language.
  "auth.emailPlaceholder",
  "auth.passwordPlaceholder",
  // `{language} ({code})`: the name is interpolated from `languages.*` and the code is data,
  // so the message itself has no word Thai could say differently.
  "studio.langOption",
  // A service and the model ids it serves: "Google AI Studio" and "Gemini 2.5 Flash" are
  // what they are called, in both languages.
  "settings.providerGeminiLabel",
  "settings.providerGeminiDescription",
  // A file format is a name: EPUB is EPUB in Thai. The two messages beside it carry no word
  // of their own — `EPUB · {fileName}` is the format and a separator, and `{from}–{to}` is
  // two interpolated numbers around an en dash — so translating them would mean inventing a
  // word the English does not have.
  "jobs.typeEpub",
  "jobs.secondaryEpubFile",
  "jobs.rangeChapters",
]);

/**
 * English that is deliberately not copy, named exactly as the value is written.
 *
 * Kept as a separate list from `IDENTICAL_ALLOWED` because it answers a different question: that
 * one permits a Thai message to equal its English source, this one permits English to appear in
 * the source at all. Each entry needs its reason, the way the catalog entries do.
 */
const ALLOWED_ENGLISH = new Set([
  // A provider's own example URL, shown as the shape of what to paste into the field. It is a URL,
  // not words: translating it would produce an address that is not where the site lives.
  "https://www.quanben.io/n/.../30.html",
  // The TSV column order a bulk glossary import is parsed by. Its third column is compared against
  // English category identifiers (`character`, `place`, `skill`, `other`) in `lib/glossary/functions.ts`,
  // so a reader who translated the header would hand the importer a file it cannot read. The
  // sentence that introduces the format is a key; the format itself is the interface.
  "source &lt;tab&gt; target &lt;tab&gt; category &lt;tab&gt; note",
]);

/**
 * A module whose English a reader never sees, and why.
 *
 * Question 8 reads every string literal in `src/` and `scripts/`, so the modules that are not a
 * surface need to say so once rather than a hundred times. Each entry names the rule that keeps the
 * text out of a reader's hands: the catalog is the copy, a prompt is addressed to a model, a page
 * signature is matched against fetched HTML, a configuration error is read by whoever deployed the
 * app, and a script has no reader at all — its English is terminal output, usage text, and the
 * fixture data an E2E run writes, which is the three shapes a script exists to produce.
 *
 * A directory is not a reason by itself, so nothing here is declared by directory alone: the entry
 * names what its English *is*. `src/lib/` as a whole is not on this list, and neither is a server
 * module for being server-only — a sentence stored for a surface to render later is copy, and the
 * questions above are about where it lives rather than about who writes it.
 */
const NON_COPY_MODULES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /^src\/lib\/i18n\/messages\//,
    reason: "the catalogs themselves: `en.ts` is the copy and `th.ts` is its translation",
  },
  {
    pattern: /^src\/lib\/legal\/copy\.ts$/,
    reason:
      "the three legal documents: English-authored prose whose Thai side is the same entry, with `copy.test.ts` holding the pair together",
  },
  {
    pattern:
      /^src\/lib\/translation\/prompts\/|^src\/lib\/relationships\/analysis-prompt\.ts$|^src\/lib\/translation\/glossary\/suggestions\.ts$/,
    reason: "text addressed to the model: English by construction, and never rendered",
  },
  {
    pattern: /^src\/lib\/epub\/text\.ts$/,
    reason:
      "the byte sequences archive text is normalized and recognized by, matched against an archive rather than shown",
  },
  {
    pattern: /^src\/lib\/env\.ts$/,
    reason:
      "boot-time configuration errors, read by whoever deployed the app rather than by a reader",
  },
  {
    pattern: /^src\/lib\/db\/database-url\.ts$/,
    reason: "the disposable-database guard, read by whoever is running a suite",
  },
  {
    pattern: /^src\/test\//,
    reason: "the suites' own scaffolding: both suites are pinned to English on purpose (§7)",
  },
  {
    pattern: /^scripts\//,
    reason:
      "a script has no reader: its English is terminal output, usage text, or the fixture an E2E run writes into the database",
  },
];

/**
 * One string in a module that is otherwise reader-facing, declared not to be copy.
 *
 * Declared by the words it opens with, because some of these are a paragraph long (a prompt built
 * in a workflow module) and the declaration should say which one it is without repeating it. Each
 * entry needs its reason, the way a catalog exemption does.
 */
const NON_COPY_TEXT: readonly {
  readonly file: string;
  readonly prefix: string;
  readonly reason: string;
}[] = [
  {
    file: "src/components/auth/provider-buttons.tsx",
    prefix: "M20.317 4.3698",
    reason: "the `d` data of a provider's own logo: a path, not a sentence",
  },
  {
    file: "src/components/reader/page/reader-page-hotkeys.tsx",
    prefix: "input, textarea, select, button",
    reason: "a selector list: the elements a keyboard shortcut must not fire inside",
  },
  {
    file: "src/lib/translation/providers/provider-client.ts",
    prefix: "(?:unsupported",
    reason: "the source of a regular expression that reads a provider's own wording",
  },
  {
    file: "src/lib/auth/auth.ts",
    prefix: "This account has been suspended.",
    reason:
      "Better Auth's `bannedUserMessage`: the plugin shows it at sign-in, where no request locale exists (§3), and the field is a configuration string rather than a message code",
  },
  {
    file: "src/lib/export/stream.ts",
    prefix: "Novel not found or has no translated chapters",
    reason:
      "the body of a 404 from the export route: the client preflights it with HEAD and words its own toast, so this text is read only by a browser that asked for the file directly",
  },
  {
    file: "src/lib/reports/report.service.server.ts",
    prefix: "A deleted novel",
    reason:
      "the title snapshot a report keeps when its novel is deleted: a stored row cannot hold a reader's language, and the case outlives the novel it names",
  },
  {
    file: "src/lib/reports/report.service.server.ts",
    prefix: "A deleted target",
    reason: "the same snapshot for a case whose target was a comment or a review",
  },
  {
    file: "src/lib/translation/api/mutations.ts",
    prefix: "Chapter not found or unauthorized",
    reason:
      "a per-chapter detail on a batch outcome: the client counts the chapters it skipped and words the message from `studio.chaptersSkippedNoActive`, so this string is never rendered",
  },
  {
    file: "src/lib/translation/api/batch.ts",
    prefix: "Failed to start translation",
    reason:
      "the same batch detail, for a chapter whose enqueue threw something that is not an error",
  },
  {
    file: "src/lib/relationships/schemas.ts",
    prefix: "updatedAt must be an ISO-8601 timestamp",
    reason:
      "a rule that validates a stored relationship map on the server: the reader sees the map's facts, not the JSON they arrived in",
  },
  {
    file: "src/components/ui/overlay-scroll-lock.tsx",
    prefix: "an untracked popup",
    reason:
      "a developer diagnostic built for the console and the analytics event that reports a stuck overlay, never rendered to a reader",
  },
  {
    file: "src/components/ui/overlay-scroll-lock.tsx",
    prefix: "(",
    reason: "the lag fragment of the same developer diagnostic",
  },
  {
    file: "src/components/ui/overlay-scroll-lock.tsx",
    prefix: "popup never finished the page —",
    reason: "the stuck-popup branch of the same developer diagnostic",
  },
  {
    file: "src/components/ui/overlay-scroll-lock.tsx",
    prefix: "page left frozen by —",
    reason: "the frozen-page branch of the same developer diagnostic",
  },
  {
    file: "src/lib/translation/evaluation/eval.schemas.ts",
    prefix: "Evaluation finding excerpts must contain at most",
    reason:
      "a rule that validates a stored evaluation report on the server; the panel renders findings, not the JSON behind them",
  },
  {
    file: "src/lib/translation/evaluation/eval.schemas.ts",
    prefix: "Only glossary findings may contain source and target terms",
    reason: "the same stored-report rule, for the fields a glossary finding owns",
  },
  {
    file: "src/lib/translation/evaluation/eval.schemas.ts",
    prefix: "Residual examples must contain at most",
    reason: "the same stored-report rule, for the examples a residual finding carries",
  },
  // The text a translation sends to a model. It is English addressed to a reader that never exists
  // as one, and the two that live outside `lib/translation/prompts/` are named here because a file
  // is not a reason on its own: `worker.ts` also stores a failure a reader does see, and that one is
  // a key.
  {
    file: "src/lib/settings/functions.ts",
    prefix: "Reply with exactly: hello",
    reason: "the probe sent to a provider to test a connection: a prompt, addressed to a model",
  },
  {
    file: "src/lib/translation/workflow/finalize-summary.ts",
    prefix: "Please summarize this chapter",
    reason: "the chapter-summary prompt",
  },
  {
    file: "src/lib/translation/workflow/finalize-summary.ts",
    prefix: "You are a novel continuity editor.",
    reason: "the rolling-synopsis prompt",
  },
  {
    file: "src/lib/translation/workflow/finalize-summary.ts",
    prefix: "Existing story synopsis:",
    reason: "the same prompt's user message, which carries the synopsis so far",
  },
  {
    file: "src/lib/translation/workflow/finalize-summary.ts",
    prefix: "None (this is the beginning of the novel).",
    reason: "what that message says when the novel has no synopsis yet: a value inside the prompt",
  },
  {
    file: "src/lib/translation/workflow/worker.ts",
    prefix: "Your translation has ||¶|| markers",
    reason: "the paragraph-marker repair prompt",
  },
  {
    file: "src/lib/translation/workflow/worker.ts",
    prefix: "Preserve uppercase Latin rank labels",
    reason: "a line appended to a translation prompt",
  },
  {
    file: "src/lib/translation/workflow/worker.ts",
    prefix: "Your translation contains letters from writing systems other than",
    reason: "the foreign-script repair prompt",
  },
];

/**
 * The vocabulary §5 fixes, as a check rather than as a promise kept by whoever writes the
 * next string.
 *
 * The glossary's table is the authority and a script cannot read prose, so only the rules
 * that table states as prohibitions are encoded — the one synonym it names, the particles
 * and the apology its voice rules forbid, and the exclamation mark. This is a guard on the
 * words already in the catalog, not a substitute for writing Thai well: a new synonym for a
 * concept the table does not name still has to be caught in review.
 */
const THAI_VOCABULARY = [
  {
    found: "นวนิยาย",
    use: "นิยาย",
    rule: "§5 novel — นวนิยาย is the literary form, not the app's object",
    pattern: /นวนิยาย/,
  },
  {
    found: "ครับ / ค่ะ",
    use: "no polite particle",
    rule: "§5 voice — product copy does not address the reader as a customer",
    pattern: /ครับ|ค่ะ/,
  },
  {
    found: "ขออภัย",
    use: "say what happened and what to do next",
    rule: "§5 voice — an error never apologises",
    pattern: /ขออภัย/,
  },
  {
    found: "!",
    use: "no exclamation mark",
    rule: "§5 voice",
    pattern: /!/,
  },
];

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
 * Only the two forms an argument can take count: `{name}` and `{name, plural, ...}`. The trailing
 * `,` or `}` is what separates an argument from a plural *branch body* — `{count, plural, one
 * {Unpublished # chapter} other {...}}` opens a branch with the word it prints, and reading
 * `Unpublished` as a placeholder reported the same eleven keys as a mismatch in a catalog where
 * nothing was wrong. A branch body is prose, and its first word is a word.
 */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)\s*[,}]/g)) {
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

/** A path as the declarations spell it, whichever separator the platform walks with. */
function normalized(path: string): string {
  return path.replaceAll("\\", "/");
}

/** The module declaration that covers a file, if one does. */
function nonCopyModule(file: string): string | null {
  const path = normalized(file);
  return NON_COPY_MODULES.find(({ pattern }) => pattern.test(path))?.reason ?? null;
}

/** The declaration that covers one string in a file, if one does. */
function nonCopyText(file: string, text: string): boolean {
  const path = normalized(file);
  return NON_COPY_TEXT.some(
    (declaration) => declaration.file === path && text.startsWith(declaration.prefix),
  );
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

const vocabulary: string[] = [];
for (const [key, value] of thKeys) {
  for (const rule of THAI_VOCABULARY) {
    if (rule.pattern.test(value)) {
      vocabulary.push(`Thai ${key} uses ${rule.found} — ${rule.use} (${rule.rule})`);
    }
  }
}
if (vocabulary.length > 0) failures.push(...vocabulary);

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

// A reference to a key the catalog does not define.
//
// Typing `encodeMessage`'s parameter catches this at compile time for the calls it sees, but a
// bare key literal handed to a schema (`required: "validation.chunkSizeRequired"`) is just a
// string — nothing types it, and nothing else checks that the key it names exists. That
// matters because of how a code fails: a message no catalog resolves is passed through
// unchanged, so a typo reaches the reader as the key itself rather than as an error.
const NAMESPACES = Object.keys(en);
const KEY_LIKE = new RegExp(
  `^(?:${NAMESPACES.join("|")})\\.[a-z][a-zA-Z0-9]*(?:\\.[a-zA-Z0-9]+)*$`,
);
// A file name is not a key, and `meta.json` is the shape that would otherwise look like one.
const FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "css",
  "md",
  "sql",
  "html",
  "txt",
  "yml",
  "yaml",
  "xml",
  "png",
  "webp",
  "jpg",
  "jpeg",
  "svg",
  "ico",
  "avif",
  "map",
  "csv",
  "epub",
  "server",
  "client",
  "test",
]);
/**
 * A key-shaped literal that is deliberately not a key.
 *
 * `log.aKeyThatMoved` is a fixture standing in for a log row written by an earlier release,
 * whose key this one no longer defines; it is exactly the case `translateMessage` exists to
 * fall back on, so it has to stay missing for that test to mean anything.
 */
const REFERENCE_ALLOWED = new Set(["log.aKeyThatMoved"]);
// Both quote forms, but not a template literal: `` `log.${key}` `` builds its key at runtime
// and has no single spelling to check.
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'/g;

const unknownKeys: string[] = [];
const jsxEnglish: string[] = [];
const attributeEnglish: string[] = [];
const literalEnglish: string[] = [];
for (const file of sourceFiles("src")) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(STRING_LITERAL)) {
    const literal = match[1] ?? match[2] ?? "";
    if (!KEY_LIKE.test(literal)) continue;
    if (REFERENCE_ALLOWED.has(literal)) continue;
    const extension = literal.split(".").pop() ?? "";
    if (FILE_EXTENSIONS.has(extension)) continue;
    if (!enKeys.has(literal)) unknownKeys.push(`${literal} (${file})`);
  }

  // Copy in the places a catalog never sees it. A test's English is the contract rather than a gap —
  // both suites are pinned to English on purpose (§7) — so the files beside a module that are tests
  // are not scanned for copy, and a module whose English no reader sees says so once, in the
  // declarations above.
  if (file.includes(".test.") || nonCopyModule(file) !== null) continue;

  // Only `.tsx` holds JSX, and only the attributes that name a control are read: an `alt` or an
  // `aria-label` is spoken to a reader who has no other way to know what the control is.
  if (file.endsWith(".tsx")) {
    for (const node of findEnglishTextNodes(file, contents)) {
      if (!ALLOWED_ENGLISH.has(node.text)) jsxEnglish.push(`"${node.text}" (${file}:${node.line})`);
    }
    for (const label of findLiteralAttributes(file, contents)) {
      if (ALLOWED_ENGLISH.has(label.text)) continue;
      attributeEnglish.push(`${label.attribute}="${label.text}" (${file}:${label.line})`);
    }
  }

  // The third shape: a plain string, which is where a `.ts` module keeps copy — a rule's message, a
  // toast, an error a surface shows, a sentence stored for a surface to render later.
  for (const node of findEnglishLiterals(file, contents)) {
    if (nonCopyText(file, node.text)) continue;
    literalEnglish.push(`"${node.text}" (${file}:${node.line})`);
  }
}
if (unknownKeys.length > 0)
  failures.push(`Referenced keys with no catalog entry: ${[...new Set(unknownKeys)].join("; ")}`);
if (jsxEnglish.length > 0)
  failures.push(`English text in JSX: ${[...new Set(jsxEnglish)].join("; ")}`);
if (attributeEnglish.length > 0)
  failures.push(`Untranslated control labels: ${[...new Set(attributeEnglish)].join("; ")}`);
// The scripts beside the app are read for copy as well, as the one place a `.ts` module can keep a
// sentence that a surface will render later: a script that seeds a novel writes reader-facing text
// into the database. The key check above stays with `src/`, where a reference is a surface's own.
for (const file of sourceFiles("scripts")) {
  if (file.includes(".test.") || nonCopyModule(file) !== null) continue;
  const contents = readFileSync(file, "utf8");
  for (const node of findEnglishLiterals(file, contents)) {
    if (nonCopyText(file, node.text)) continue;
    literalEnglish.push(`"${node.text}" (${file}:${node.line})`);
  }
}
if (literalEnglish.length > 0)
  failures.push(`English outside the catalogs: ${[...new Set(literalEnglish)].join("; ")}`);

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
