export const RETRY_COUNT = 3;

/**
 * Runs an operation once plus the configured retry count.
 * The final failure is rethrown unchanged so callers can preserve their own
 * non-fatal fallback and logging behavior.
 */
export async function retryOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
