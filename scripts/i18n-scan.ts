/**
 * The three places copy hides from a catalog check.
 *
 * `bun run i18n:check` reads the catalogs, which is why a page whose whole body was English JSX
 * rendered Thai chrome around English prose for a release without anything failing. Copy reaches a
 * reader without ever naming a key, in three shapes that are not a catalog entry: a JSX text node, a
 * control's `aria-label`/`placeholder`/`title`/`alt`, and a plain string in a `.ts` module — the
 * message of a Zod rule, a toast, a sentence stored for a surface to render later. Each needs its
 * own reading of the source, in this module, kept pure so it can be tested without running the
 * check.
 *
 * Every reading is a parse, not a regular expression. A first attempt scanned for anything between
 * `>` and `<` and reported `Promise<void>`, `case "queued": return (` and half a dozen type
 * annotations as English, which is the failure mode this module exists to avoid: a check nobody
 * trusts is worse than no check. `oxc-parser` is the parser already present in this tree — it is
 * what `oxlint` runs on — and a real AST answers all three questions exactly.
 *
 * The three readings differ in what they can assume. A JSX text node is copy by construction and
 * `findEnglishTextNodes` reads three words as enough. A literal is not, so `findEnglishLiterals`
 * asks for a word only a sentence uses — which is what tells `Rows per page` from
 * `flex items-center justify-between` — and knows the calls whose arguments a reader does see.
 */

import { parseSync } from "oxc-parser";

import { parseMessage } from "../src/lib/i18n/message-code";

/** Thai script, which means this text already came from a translator. */
const THAI = /[\u0E00-\u0E7F]/;

/** An ASCII word of at least two letters. */
const ASCII_WORD = /[A-Za-z]{2,}/g;

/**
 * A word only a sentence uses — `the`, `of`, `your`, `must`. A reader-facing line has one; a class
 * list, a path and an identifier do not.
 *
 * This is what the literal reader needs and the JSX reader does not: a text node between two tags is
 * copy by construction, so three words are evidence enough there, while a string literal is equally
 * likely to be `flex items-center justify-between gap-2` — three words, no function word — or
 * `chapter-range-from`. The words below are function words in the grammatical sense, and reading
 * them is safe here because `words` splits on whitespace: `justify-between` and `chapter-range-from`
 * are one word each, so neither can supply one.
 */
const FUNCTION_WORD: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "for",
  "from",
  "to",
  "in",
  "into",
  "on",
  "at",
  "by",
  "between",
  "over",
  "under",
  "through",
  "per",
  "any",
  "some",
  "it",
  "with",
  "without",
  "your",
  "you",
  "we",
  "our",
  "its",
  "this",
  "that",
  "these",
  "those",
  "not",
  "if",
  "when",
  "while",
  "before",
  "after",
  "than",
  "then",
  "as",
  "but",
  "can",
  "cannot",
  "must",
  "should",
  "will",
  "would",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "please",
  "each",
  "every",
  "all",
  "only",
  "there",
  "they",
  "them",
  "their",
  "which",
  "what",
  "whose",
  "again",
  "about",
]);

/**
 * A statement for the database, at the head of a string.
 *
 * Case-sensitive on purpose: every statement in this tree is written in upper case at the verb, and
 * a sentence of copy that opens with the word `Select` does not have one after it in capitals.
 */
const SQL_STATEMENT =
  /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|WITH)\b/;

/**
 * A fragment of a statement: the words a query is written in, in the capitals this tree writes them
 * in. `AND EXISTS ( SELECT 1 FROM … )` opens a query the same way a verb does, and two of these in
 * one string is a query rather than a sentence — prose that reaches a reader is written in sentence
 * case, where `SELECT` and `FROM` never appear in capitals.
 */
const SQL_WORDS =
  /\b(?:SELECT|FROM|WHERE|JOIN|EXISTS|VALUES|CASE|WHEN|THEN|END|SET|ON|AS|DESC|ASC)\b/g;

function looksLikeSql(text: string): boolean {
  if (SQL_STATEMENT.test(text)) return true;
  return (text.match(SQL_WORDS) ?? []).length >= 2;
}

/** The attributes whose literal value a reader hears or reads: a control's name, or a hint. */
export const TRANSLATABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-label",
  "placeholder",
  "title",
  "alt",
]);

/** Copy found in one source file, with where it is. */
export interface SourceCopy {
  /** The English as written, with runs of whitespace collapsed. */
  readonly text: string;
  /** 1-based line, so a failure points at the code rather than the file. */
  readonly line: number;
  /** The attribute's name, for a label; unset for a text node. */
  readonly attribute?: string;
}

/**
 * The little of a parsed node this module reads.
 *
 * Deliberately structural rather than the parser's own types: the module asks two questions of the
 * tree and should not break when either package widens its AST typing.
 */
interface AstNode {
  readonly type?: string;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly start?: number;
  readonly [key: string]: unknown;
}

function asNode(value: unknown): AstNode | null {
  return value !== null && typeof value === "object" && "type" in value ? (value as AstNode) : null;
}

function lineOf(source: string, offset: number | undefined): number {
  if (offset === undefined) return 0;
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

/**
 * The findings in the order the file reads.
 *
 * The tree is walked with a stack, so a node is visited before its children and a later sibling
 * before an earlier one: found order is not source order, and a report that lists line 105 before
 * line 27 is one a reviewer has to reassemble mentally. Sorting by line makes the output read like
 * the file it names.
 */
function inSourceOrder(found: SourceCopy[]): SourceCopy[] {
  return found.toSorted((left, right) => left.line - right.line);
}

/** Every node in the tree, without recursing (deep JSX nests deeply). */
function walk(program: unknown): AstNode[] {
  const nodes: AstNode[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const node = asNode(current);
    if (node) nodes.push(node);
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      // `parent` would cycle and the positions are numbers; everything else may hold child nodes.
      if (key === "parent" || key === "loc") continue;
      if (Array.isArray(value)) stack.push(...value);
      else if (value !== null && typeof value === "object") stack.push(value);
    }
  }
  return nodes;
}

function parse(fileName: string, source: string): AstNode[] {
  const result = parseSync(fileName, source);
  if (result.errors.length > 0) {
    // A file that does not parse is a build failure of its own (`bun run typecheck`), so this
    // reports rather than guesses: reading copy out of a broken tree would be noise.
    const [first] = result.errors;
    throw new Error(`${fileName} could not be parsed: ${first?.message ?? "unknown error"}`);
  }
  return walk(result.program);
}

/**
 * Whether a stretch of JSX text reads as English prose rather than as a fragment.
 *
 * Three words is the threshold because that is the shortest thing that cannot be a name or a unit
 * on its own: `Rows per page` is copy, `EPUB` and `2 MB` are not. Thai text is never reported, since
 * a text node that is already Thai is the absence this is looking for.
 */
function looksLikeEnglishProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || THAI.test(trimmed)) return false;
  return (trimmed.match(ASCII_WORD) ?? []).length >= 3;
}

/**
 * Every JSX text node that reads as English prose in one source file.
 *
 * A text node is what a reader sees between tags. An expression — `{t("reader.title")}`, `{count}` —
 * is a different node type and is not reported, which is what keeps this precise: the earlier
 * heuristic could not tell `{count} chapters` from a type annotation.
 */
export function findEnglishTextNodes(fileName: string, source: string): SourceCopy[] {
  const found: SourceCopy[] = [];
  for (const node of parse(fileName, source)) {
    if (node.type !== "JSXText" || typeof node.value !== "string") continue;
    if (!looksLikeEnglishProse(node.value)) continue;
    found.push({
      text: node.value.trim().replace(/\s+/g, " "),
      line: lineOf(source, node.start),
    });
  }
  return inSourceOrder(found);
}

/**
 * Every literal value of an attribute that names a control, in one source file.
 *
 * `aria-label={t("common.loading")}` is an expression and is not reported; `aria-label="Loading"` is
 * copy that never reached a catalog, which is the shape this exists to find. The caller decides
 * which values are deliberately English (a URL example) the way it decides it for messages.
 */
export function findLiteralAttributes(fileName: string, source: string): SourceCopy[] {
  const found: SourceCopy[] = [];
  for (const node of parse(fileName, source)) {
    if (node.type !== "JSXAttribute") continue;
    const name = asNode(node.name);
    const attribute = name && typeof name.name === "string" ? name.name : null;
    if (!attribute || !TRANSLATABLE_ATTRIBUTES.has(attribute)) continue;
    const initializer = asNode(node.value);
    if (!initializer || initializer.type !== "Literal" || typeof initializer.value !== "string")
      continue;
    const text = initializer.value.trim();
    if (text.length === 0 || (text.match(ASCII_WORD) ?? []).length === 0) continue;
    found.push({ text, line: lineOf(source, node.start), attribute });
  }
  return inSourceOrder(found);
}

/**
 * The words of a string as a sentence reads them: split on whitespace, with the punctuation around
 * each word removed.
 *
 * Splitting this way is what keeps `justify-between` and `chapter-range-to` from looking like a
 * sentence: both are one word, so neither can supply the function word the test asks for.
 */
function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z']+/, "").replace(/[^A-Za-z']+$/, ""))
    .filter((token) => token.length > 0);
}

/**
 * Whether a string literal reads as a sentence rather than as a name, a path or a class list.
 *
 * Two conditions, and both are needed: at least three words, so a two-word label cannot be prose by
 * itself, and at least one of them a word only a sentence uses.
 */
function readsLikeSentence(text: string): boolean {
  const tokens = words(text);
  if (tokens.length < 3) return false;
  return tokens.some((token) => FUNCTION_WORD.has(token.toLowerCase()));
}

/**
 * The call whose arguments are text someone reads: a toast, and the error a surface shows.
 *
 * Both take their words from a key at every call site in this tree — `t("…")`, `encodeMessage("…")` —
 * and a plain string in either is copy that never reached the catalog, however short it is. The
 * sentence rule above cannot see `Export failed`, which is exactly the shape that hides.
 */
function isReaderFacingCallee(name: string): boolean {
  return name.startsWith("toast.") || name === "SafeServerError";
}

/**
 * Whether a literal is an argument the reader sees, as opposed to one an expression around it swallowed.
 *
 * `toast.success("Export failed")` is copy; `toast.success(t("studio.exported"))` is a call whose own
 * argument is a key, and reading that leaf as copy would report the answer rather than the mistake.
 */
function isReaderFacingArgument(value: unknown): boolean {
  const node = asNode(value);
  return node?.type === "Literal" || node?.type === "TemplateLiteral";
}

/**
 * The call whose arguments are diagnostics: written to a log, or thrown for `withSafeHandler` and
 * the terminal.
 *
 * `withSafeHandler` replaces an unknown failure with a safe message and logs the original, so a
 * thrown `Error`'s text is read by whoever is debugging rather than by the reader. A name ending in
 * `Error` covers the error classes this tree defines (`HostResolutionError`, `StorageKeyError`),
 * whose message is the diagnostic half of a failure whose `code` is the reader-facing one.
 */
function isDiagnosticCallee(name: string): boolean {
  // `SafeServerError` ends in `Error` and is the one name that must not be read this way: it is
  // the error a surface shows the reader, so a sentence in it is copy rather than a diagnostic.
  if (isReaderFacingCallee(name)) return false;
  return (
    name.startsWith("console.") ||
    name === "process.stdout.write" ||
    name === "process.stderr.write" ||
    name === "log" ||
    name.endsWith("Error")
  );
}

/** The dotted name of a callee: `console.error`, `toast.success`, `log`, or `super`. */
function calleeName(node: AstNode): string {
  const callee = asNode(node.callee);
  if (!callee) return "";
  if (callee.type === "Super") return "super";
  if (callee.type === "Identifier" && typeof callee.name === "string") return callee.name;
  const object = asNode(callee.object);
  const property = asNode(callee.property);
  const head = object && typeof object.name === "string" ? object.name : "";
  const tail = property && typeof property.name === "string" ? property.name : "";
  return head && tail ? `${head}.${tail}` : head || tail;
}

/** Every string literal and template in a subtree, by offset, so one argument list can be read whole. */
function textOffsets(value: unknown, into: Set<number>): void {
  const node = asNode(value);
  if (!node) return;
  if (
    (node.type === "Literal" || node.type === "TemplateLiteral") &&
    typeof node.start === "number"
  ) {
    into.add(node.start);
  }
  for (const [key, child] of Object.entries(node)) {
    // `parent` would cycle and the positions are numbers; everything else may hold child nodes.
    if (key === "parent" || key === "loc") continue;
    if (Array.isArray(child)) for (const item of child) textOffsets(item, into);
    else if (child !== null && typeof child === "object") textOffsets(child, into);
  }
}

/**
 * Every string literal that reads as copy in a `.ts` or `.tsx` file, with where it is.
 *
 * The third place copy hides, after a JSX text node and a control's label: a string. A `.tsx`
 * module holds copy in literals as well as in text nodes, and a `.ts` module holds it where no
 * catalog reaches — a Zod rule's message, a toast, a `SafeServerError`, a sentence stored for a
 * surface to render later.
 *
 * What is not reported, and why, is the whole of the rule:
 *
 * - A diagnostic: the arguments of `console.*`, `process.std*.write`, `log` and anything named
 *   `…Error`, and a base class's own message through `super(…)`. Text written for whoever is
 *   debugging is not text a reader sees, and `withSafeHandler` replaces the rest before it ships.
 * - A statement for the database: a `sql` tagged template, or a string that opens with a SQL verb.
 * - A pattern or a document: the argument of `RegExp`, and markup — a string that opens with `<` is
 *   a document this file builds rather than a sentence of ours.
 * - Text that is already Thai, which means it came from a translator.
 *
 * Everything else needs both tests the sentence rule states. A toast or a `SafeServerError` needs
 * only one word of one: those two calls are reader copy by construction.
 */
export function findEnglishLiterals(fileName: string, source: string): SourceCopy[] {
  const nodes = parse(fileName, source);
  const diagnostics = new Set<number>();
  const readerFacing = new Set<number>();
  for (const node of nodes) {
    if (node.type === "TaggedTemplateExpression") {
      const tag = asNode(node.tag);
      if (tag && typeof tag.name === "string" && tag.name === "sql") {
        textOffsets(asNode(node.quasi), diagnostics);
      }
      continue;
    }
    if (node.type !== "CallExpression" && node.type !== "NewExpression") continue;
    const name = calleeName(node);
    const into =
      name === "super" || isDiagnosticCallee(name)
        ? diagnostics
        : name === "RegExp"
          ? diagnostics
          : isReaderFacingCallee(name)
            ? readerFacing
            : null;
    if (!into) continue;
    const readerFacingCall = into === readerFacing;
    for (const argument of (node.arguments as unknown[] | undefined) ?? []) {
      if (!readerFacingCall) textOffsets(argument, into);
      else if (isReaderFacingArgument(argument)) textOffsets(argument, into);
    }
  }

  const found: SourceCopy[] = [];
  for (const node of nodes) {
    if (typeof node.start !== "number" || diagnostics.has(node.start)) continue;
    let text: string | null = null;
    if (node.type === "Literal" && typeof node.value === "string") text = node.value;
    if (node.type === "TemplateLiteral") {
      // A quasi's `value` is the parser's own `{raw, cooked}` pair rather than a node, so it is read
      // directly: `asNode` looks for a `type` and would hand back nothing for every template.
      const quasis = (node.quasis as Array<{ value?: { cooked?: unknown } }> | undefined) ?? [];
      text = quasis
        .map((quasi) => quasi.value?.cooked)
        .map((cooked) => (typeof cooked === "string" ? cooked : ""))
        .join(" ");
    }
    if (text === null) continue;
    const collapsed = text.trim().replace(/\s+/g, " ");
    if (collapsed.length === 0 || THAI.test(collapsed)) continue;
    if (collapsed.startsWith("<") || looksLikeSql(collapsed)) continue;
    // A code is the answer rather than the mistake: `encodeMessage("errors.chapterNotFound")` in a
    // toast is copy the catalog already holds, and the question that checks a referenced key names
    // one is the next one along.
    if (parseMessage(collapsed) !== null) continue;
    const readsAsCopy = readerFacing.has(node.start)
      ? (collapsed.match(ASCII_WORD) ?? []).length > 0
      : readsLikeSentence(collapsed);
    if (!readsAsCopy) continue;
    found.push({ text: collapsed, line: lineOf(source, node.start) });
  }
  return inSourceOrder(found);
}
