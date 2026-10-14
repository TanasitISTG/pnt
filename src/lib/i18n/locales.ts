/**
 * The locale vocabulary, and the URL rules that carry it.
 *
 * Pure and isomorphic: the router, the request middleware, the language switcher, the head
 * tags and the sitemap all read these, so nothing here may touch the request, the database
 * or the environment, beyond the one build-time value that names the default language.
 *
 * Thai is the default, and the default is the language without a prefix: `/catalog` is
 * Thai and `/en/catalog` is English. An ignored path (see `shouldIgnorePath`) never carries
 * a prefix at all and reads the remembered choice from the cookie instead, which is why the
 * signed-in work areas keep the URLs they already had.
 */

export const SUPPORTED_LOCALES = ["th", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * A language names itself in its own language. "Thai" would be the English word for it, and
 * a reader who cannot read the current language is exactly who needs to find their own.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  th: "ไทย",
  en: "English",
};

export const LOCALE_COOKIE = "pnt-locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * `VITE_DEFAULT_LOCALE` names the language the app ships in. The value has to be visible to
 * both bundles, which is why it is read from Vite's environment rather than from
 * `src/lib/env.ts`; `scripts/e2e/run.ts` and `vite.config.ts` point it at English so the test
 * suites keep asserting the copy they have always asserted. Anything unrecognized falls back
 * to Thai rather than throwing, because a wrong language is a worse failure than a missing one.
 */
export const defaultLocale: Locale = resolveDefaultLocale(configuredLocale());

/**
 * The configured default, from whichever environment this module is running in.
 *
 * Vite's own environment is the first source, and the process environment is the fallback:
 * a plain Bun script (a seed, the translation check) has no Vite environment at all, and
 * Vitest passes its `test.env` values through the process rather than through the runtime
 * `import.meta.env` object. The guard keeps `process` from being a bare reference in the
 * browser, where it does not exist.
 */
function configuredLocale(): unknown {
  const fromVite = (import.meta as unknown as { env?: Record<string, unknown> }).env
    ?.VITE_DEFAULT_LOCALE;
  if (typeof fromVite === "string") return fromVite;
  if (typeof process === "undefined") return undefined;
  return process.env.VITE_DEFAULT_LOCALE;
}

function resolveDefaultLocale(configured: unknown): Locale {
  return isLocale(configured) ? configured : "th";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "th" ? "en" : "th";
}

/** The locale a pathname begins with, or null when it begins with none. */
export function localeFromPathname(pathname: string): Locale | null {
  const match = /^\/([^/?#]+)/.exec(pathname);
  const first = match?.[1];
  return isLocale(first) ? first : null;
}

/** The same pathname without its locale prefix. A bare `/` stays `/`. */
export function stripLocaleFromPath(pathname: string): string {
  if (!localeFromPathname(pathname)) return pathname;
  const rest = pathname.replace(/^\/[^/?#]+/, "");
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * The paths a locale prefix never appears on.
 *
 * These are the signed-in work areas, plus the machine endpoints. Their URLs are not shared
 * and not indexed, so they keep their shape and take the reader's remembered language from
 * the cookie; only the reading surfaces get a language in the URL, where it is what makes
 * two indexable documents instead of one.
 */
const IGNORED_EXACT_PATHS = new Set([
  "/api",
  "/robots.txt",
  "/library",
  "/jobs",
  "/profile",
  "/settings",
  "/admin",
  "/novels/new",
]);

const IGNORED_PATH_PREFIXES = [
  "/api/",
  "/library/",
  "/jobs/",
  "/profile/",
  "/settings/",
  "/admin/",
] as const;

/** The working areas of one novel: everything except reading it. */
const IGNORED_PATH_PATTERNS = [/^\/novels\/[^/]+\/(?:edit|glossary|manage|relationships)(?:\/|$)/];

export function shouldIgnorePath(pathname: string): boolean {
  const path = stripLocaleFromPath(pathname);
  if (IGNORED_EXACT_PATHS.has(path)) return true;
  if (IGNORED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The language of one request.
 *
 * A reading surface answers with the language in its own URL, always, even when the cookie
 * disagrees: the URL is what a shared link promises and what a crawler indexes. Everywhere
 * else the remembered choice decides.
 */
export function localeForPathname(pathname: string, remembered: Locale | null): Locale {
  if (shouldIgnorePath(pathname)) return remembered ?? defaultLocale;
  return localeFromPathname(pathname) ?? defaultLocale;
}

/**
 * The path parameter that puts a link in one language, as a route wants it.
 *
 * The default language is `undefined` rather than its own code: `/catalog` is the canonical
 * URL for Thai, so filling in `th` would only earn a redirect back. Anything that is not a
 * supported locale yields `undefined` too, which keeps a malformed parameter out of the href
 * instead of turning it into a 404.
 */
export function localeParam(locale: string | null | undefined): Locale | undefined {
  if (!isLocale(locale) || locale === defaultLocale) return undefined;
  return locale;
}

/** A bare path in one language, for `hreflang`, the sitemap and the switcher. */
export function localizedPath(pathname: string, locale: Locale): string {
  const bare = stripLocaleFromPath(pathname);
  if (shouldIgnorePath(bare)) return bare;
  if (locale === defaultLocale) return bare;
  return bare === "/" ? `/${locale}` : `/${locale}${bare}`;
}

/** The same href (path, query and fragment) in one language. */
export function localizedHref(href: string, locale: Locale): string {
  const url = new URL(href, "http://localhost");
  url.pathname = localizedPath(url.pathname, locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Both languages of one page, in `SUPPORTED_LOCALES` order. */
export function localeAlternates(pathname: string): Array<{ locale: Locale; href: string }> {
  return SUPPORTED_LOCALES.map((locale) => ({ locale, href: localizedPath(pathname, locale) }));
}

export function parseLocaleCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return isLocale(value) ? value : null;
  }
  return null;
}

/** The `Set-Cookie` value that remembers one language, readable on every path. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export interface LocaleRequestDecision {
  /** A same-origin path to redirect to, or null when the request URL is already canonical. */
  redirectTo: string | null;
  /** A `Set-Cookie` value recording the language the URL itself shows, or null. */
  setCookie: string | null;
}

/**
 * What one incoming request should do about its language, decided before any rendering.
 *
 * Two canonicalizations, and no more. The default language never keeps its prefix, because
 * two URLs for one document is what a sitemap has to avoid; and a prefix never sticks to an
 * ignored path, because that path has no localized form to begin with. A reading surface is
 * never redirected for language reasons: the URL says which language it is, and a crawler
 * that is told otherwise is a crawler that indexes the wrong document.
 */
export function resolveLocaleRequest(input: {
  pathname: string;
  search: string;
  cookieHeader: string | null;
}): LocaleRequestDecision {
  const { pathname, search, cookieHeader } = input;
  const prefix = localeFromPathname(pathname);

  if (shouldIgnorePath(pathname)) {
    return prefix
      ? { redirectTo: `${stripLocaleFromPath(pathname)}${search}`, setCookie: null }
      : { redirectTo: null, setCookie: null };
  }

  if (prefix === defaultLocale) {
    return { redirectTo: `${stripLocaleFromPath(pathname)}${search}`, setCookie: null };
  }

  if (prefix && prefix !== parseLocaleCookie(cookieHeader)) {
    return { redirectTo: null, setCookie: localeCookie(prefix) };
  }

  return { redirectTo: null, setCookie: null };
}
