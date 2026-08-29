export const TRANSLATION_RETRY_COUNT = 3;

/**
 * Runs an auxiliary translation operation once plus the configured retry count.
 * The final failure is rethrown unchanged so callers can preserve their own
 * non-fatal fallback and logging behavior.
 */
export async function retryTranslationOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= TRANSLATION_RETRY_COUNT; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
