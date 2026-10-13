import { log } from "@/lib/log";

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

export class RateLimitError extends SafeServerError {
  constructor() {
    super("Too many requests");
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
    super("Actions are unavailable while you are viewing as another account.");
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
    throw new Error("Something went wrong.", { cause: err });
  }
}
