import { encodeMessage } from "@/lib/i18n/message-code";
import { log } from "@/lib/log";

/**
 * The signal that a request has no usable session.
 *
 * Its message is deliberately NOT a catalog key. Nothing renders it: the client reads the
 * error's `name` and redirects to the sign-in page, and `withSafeHandler` uses the same string
 * as its internal "this should have been an UnauthorizedError" marker. Translating it would
 * give a sentinel two jobs and make the redirect depend on a message no one reads.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class SafeServerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SafeServerError";
  }
}

/**
 * Raised when an account has spent its budget for an action.
 *
 * The message is a code, like every other message a server produces: this is thrown while
 * several requests are in flight, and there is no ambient locale here to word it in, so it is
 * resolved by whoever renders it. It is also the most-seen error in the app, and it used to be
 * the most-seen English one.
 */
export class RateLimitError extends SafeServerError {
  constructor() {
    super(encodeMessage("errors.rateLimited"));
    this.name = "RateLimitError";
  }
}

/**
 * Raised when an operator viewing as another account tries to change something.
 *
 * It extends SafeServerError so its copy reaches the operator as written rather
 * than being replaced by the generic failure message.
 */
export class ImpersonationReadOnlyError extends SafeServerError {
  constructor() {
    super(encodeMessage("errors.impersonationReadOnly"));
    this.name = "ImpersonationReadOnlyError";
  }
}

export async function withSafeHandler<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const name = err instanceof Error ? err.name : undefined;
    if (
      err instanceof UnauthorizedError ||
      err instanceof SafeServerError ||
      err instanceof RateLimitError ||
      name === "UnauthorizedError" ||
      name === "SafeServerError" ||
      name === "RateLimitError"
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") {
      throw new UnauthorizedError();
    }
    log("error", "Unhandled server function error", { error: message });
    // The generic failure is copy like any other. The cause stays in the log line above, where
    // an operator can read it, so nothing is lost by handing the reader a translated sentence.
    throw new Error(encodeMessage("common.somethingWentWrong"), { cause: err });
  }
}
