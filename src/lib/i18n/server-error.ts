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

  const message = raw ? parseMessage(raw) : null;
  if (message) {
    // The code is a runtime string: keys are typed from the catalog, and this is exactly the
    // boundary where a key stops being a compile-time literal.
    const key = message.key as Parameters<Translator>[0];
    return message.values ? t(key, message.values as Parameters<Translator>[1]) : t(key);
  }

  return raw || fallback;
}
