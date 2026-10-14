import { createIsomorphicFn } from "@tanstack/react-start";

import { defaultLocale, localeForPathname, parseLocaleCookie, type Locale } from "./locales";

/**
 * The language of the document on screen right now.
 *
 * The two branches answer the same question from the only source that exists on each side:
 * the request URL on the server, the address bar and the cookie in the browser. Keeping the
 * client branch free of any server import is what lets a router revalidation read the
 * language without a round trip, and what keeps the server module out of the client bundle.
 *
 * The account's own remembered language is the last resort, not the first: a signed-in
 * reader who has never used this browser gets their choice back, while a URL that states a
 * language always wins over it. Only the ignored paths - the signed-in work areas - consult
 * it at all, which is what `localeForPathname` decides.
 *
 * The server branch imports its helper lazily on purpose. A top-level import of
 * `@tanstack/react-start/server` in this module would reach the client graph through
 * `__root.tsx` and fail the build's import protection.
 */
export const resolveDocumentLocale = createIsomorphicFn()
  .server(async (viewerLocale: Locale | null): Promise<Locale> => {
    const { localeFromCurrentRequest } = await import("./request-locale.server");
    return localeFromCurrentRequest(viewerLocale);
  })
  .client(async (viewerLocale: Locale | null): Promise<Locale> => {
    if (typeof window === "undefined") return viewerLocale ?? defaultLocale;
    const remembered = parseLocaleCookie(document.cookie) ?? viewerLocale;
    return localeForPathname(window.location.pathname, remembered);
  });
