import { getRequest } from "@tanstack/react-start/server";

import { defaultLocale, localeForPathname, parseLocaleCookie, type Locale } from "./locales";

/**
 * The language of the document request being server-rendered.
 *
 * Server-only, and deliberately narrow: it reads the incoming document's own URL and cookie
 * and nothing else, so there is no ambient locale for a concurrent request to inherit. The
 * viewer's remembered language arrives as an argument rather than as a session lookup, so
 * this stays a pure reading of the request. When there is no request at all (a build step, a
 * script that imports a route module) the default language is the only honest answer.
 */
export function localeFromCurrentRequest(viewerLocale: Locale | null = null): Locale {
  try {
    const request = getRequest();
    if (!request) return viewerLocale ?? defaultLocale;
    const url = new URL(request.url);
    const remembered = parseLocaleCookie(request.headers.get("cookie")) ?? viewerLocale;
    return localeForPathname(url.pathname, remembered);
  } catch {
    return viewerLocale ?? defaultLocale;
  }
}
