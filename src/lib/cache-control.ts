// Shared Cache-Control builders for public route responses.
//
// Vercel's CDN only caches a Function response when the header carries
// `s-maxage` (or a CDN-Cache-Control variant); `max-age` alone only controls the
// browser. Vercel consumes and strips `s-maxage` before the response reaches the
// client, so browsers keep their own `max-age` window while the edge caches.

export const ONE_YEAR_SECONDS = 31_536_000;

/** Content-addressed public assets that must never be revalidated. */
export function immutablePublicCacheControl(): string {
  return `public, max-age=${ONE_YEAR_SECONDS}, immutable, s-maxage=${ONE_YEAR_SECONDS}`;
}

/** Public responses tolerated to be briefly stale, revalidated in the background. */
export function revalidatingPublicCacheControl(
  maxAgeSeconds: number,
  staleWhileRevalidateSeconds: number,
): string {
  return `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}
