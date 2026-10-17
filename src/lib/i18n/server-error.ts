import type { createTranslator } from "use-intl/core";

import { parseMessage } from "./message-code";

/**
 * The translator a message code is resolved with: `useTranslations()` with no namespace, so
 * a key carries its own namespace and a code can be resolved from anywhere in the app.
 */
export type Translator = ReturnType<typeof createTranslator>;

/**
 * The words to show for something the server said.
 *
 * A message code is rendered through the catalog, in the language the page is already in. Any
 * other message is passed through exactly as it arrived, which is what keeps every
 * not-yet-migrated server string working in the meantime. `fallback` is for a rejection with
 * no message at all, where the caller knows what it was trying to do.
 */
export function translateServerError(error: unknown, t: Translator, fallback = ""): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof (error as { message?: unknown } | null)?.message === "string"
          ? String((error as { message: string }).message)
          : "";

  return translateMessage(raw, t) ?? (raw || fallback);
}

/**
 * The words for one message, or null when it is not a code this catalog can resolve.
 *
 * The existence check is what makes stored messages safe. A job log written by the previous
 * release may name a key that has since been renamed or removed, and a reader scrolling a
 * run's console should see the sentence that was stored rather than an error thrown from the
 * middle of rendering the list. A code we do know renders through the catalog, so the same
 * row reads in Thai for one reader and in English for the next.
 */
export function translateMessage(raw: string, t: Translator): string | null {
  return resolveMessage(raw, t, 0);
}

/**
 * How deep a message may nest another message inside its values before the nesting is ignored.
 *
 * The app only ever nests one level - a wrapper names the field that failed and the rule that
 * failed on it - so this is a guard against a cycle, not a limit anyone should reach.
 */
const MAX_MESSAGE_DEPTH = 4;

function resolveMessage(raw: string, t: Translator, depth: number): string | null {
  const message = raw ? parseMessage(raw) : null;
  if (!message) return null;

  // The code is a runtime string: keys are typed from the catalog, and this is exactly the
  // boundary where a key stops being a compile-time literal.
  const key = message.key as Parameters<Translator>[0];
  if (!t.has(key)) return null;
  if (!message.values || depth >= MAX_MESSAGE_DEPTH) return t(key);

  // A value may itself be a message. `"{path}: {message}"` names the field a file failed on
  // and the rule it failed, and the rule is a sentence of its own, so it is resolved here too
  // rather than reaching the reader as its key.
  const resolved: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(message.values)) {
    resolved[name] =
      typeof value === "string" ? (resolveMessage(value, t, depth + 1) ?? value) : value;
  }
  return t(key, resolved as Parameters<Translator>[1]);
}
