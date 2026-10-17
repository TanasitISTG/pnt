/**
 * The wire form of a server-produced message.
 *
 * A server has no way to know its reader's language: requests run concurrently, there is no
 * ambient locale, and guessing one is how two readers get each other's words. So the server
 * sends a key, and the client resolves it against the catalog it is already rendering with.
 *
 * The code is `key` or `key|{"param":"value"}` — small, readable in a log, and unmistakable
 * for what it is, which is what lets everything else keep working: a message that is not a
 * code (Better Auth's own English, a message from before this change, a key with no catalog
 * entry) passes through untouched rather than turning into a placeholder.
 */
import type { Messages } from "./messages";

export interface ServerMessage {
  key: string;
  values?: Record<string, string | number>;
}

/**
 * Every key in the catalog, dotted: `errors.chapterNotFound`, `reader.toolbar`.
 *
 * Both catalogs are exactly two levels deep — a namespace and the keys beneath it — so this
 * is a mapped type rather than a recursive one, and it stays cheap for the compiler. Typing
 * the parameter is what turns a mistyped key from a string the reader eventually sees into
 * a `bun run typecheck` failure at the call site.
 */
export type MessageKey = {
  [Namespace in keyof Messages]: `${Namespace & string}.${keyof Messages[Namespace] & string}`;
}[keyof Messages];

const SEPARATOR = "|";

/** `namespace.key` or `namespace.section.key`, lower camelCase, as the catalogs are written. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

export function encodeMessage(key: MessageKey, values?: Record<string, string | number>): string {
  if (!values || Object.keys(values).length === 0) return key;
  return `${key}${SEPARATOR}${JSON.stringify(values)}`;
}

/** The key and values in a server message, or null when it is an ordinary sentence. */
export function parseMessage(value: string): ServerMessage | null {
  const separator = value.indexOf(SEPARATOR);
  const key = separator === -1 ? value : value.slice(0, separator);
  if (!KEY_PATTERN.test(key)) return null;
  if (separator === -1) return { key };

  try {
    const values: unknown = JSON.parse(value.slice(separator + 1));
    if (typeof values !== "object" || values === null || Array.isArray(values)) return { key };
    return { key, values: values as Record<string, string | number> };
  } catch {
    // A key followed by something that is not JSON is still a key; the values are the only
    // part that was lost, and a message with a missing parameter reads better than no message.
    return { key };
  }
}

export function isMessageCode(value: string): boolean {
  return parseMessage(value) !== null;
}
