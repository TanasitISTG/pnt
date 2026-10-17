import { createTranslator } from "use-intl/core";

import { translateMessage } from "@/lib/i18n/server-error";
import en from "@/lib/i18n/messages/en";

/**
 * The English words a message code resolves to, for the suites that assert copy.
 *
 * A provider failure travels as a code (`lib/i18n/message-code.ts`) rather than a sentence: the
 * worker that classified it has no reader and no language, and the same failure is shown in the
 * settings banner and in a job's log row. The unit suite is pinned to English on purpose (i18n.md
 * §7) and its copy is the behaviour contract, so a server-side test asserts the *words* by
 * resolving the code through the English catalog here — the code is what the code promises, and
 * this is what the reader gets. A message that is not a code comes back as it is.
 */
const english = createTranslator({ locale: "en", messages: en });

export function englishWords(message: string): string {
  return translateMessage(message, english) ?? message;
}

/**
 * The error a call rejected with, so a test can read the code and the words separately.
 *
 * Asserting an error's message against the code the test itself passed in would pass even if
 * production chose the wrong code, so the provider suites capture the failure and resolve its
 * message: what the banner and a job's log row will show.
 */
export async function rejectionOf(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with something that is not an error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** The same, for a call that throws rather than rejecting. */
export function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`threw something that is not an error: ${String(error)}`, { cause: error });
  }
  throw new Error("expected the call to throw, but it returned");
}
