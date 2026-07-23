import { log } from "@/lib/log";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class SafeServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeServerError";
  }
}

export async function withSafeHandler<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (
      err instanceof UnauthorizedError ||
      err instanceof SafeServerError ||
      err?.name === "UnauthorizedError" ||
      err?.name === "SafeServerError"
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
