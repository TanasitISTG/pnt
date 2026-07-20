import { waitUntil } from "@vercel/functions";

/**
 * Runs `work` after the response is sent. On Vercel, `waitUntil` keeps the
 * function alive until the promise settles; locally there is no request
 * context, so the promise just runs in the long-lived dev-server process.
 */
export function runInBackground(work: Promise<unknown>): void {
  const p = work.catch((err) => console.error("[background] work failed:", err));
  try {
    waitUntil(p);
  } catch {
    // Local dev: no Vercel request context — the dev server outlives the request.
  }
}
