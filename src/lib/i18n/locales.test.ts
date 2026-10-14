import { describe, expect, it } from "vitest";

import {
  LOCALE_COOKIE,
  defaultLocale,
  isLocale,
  localeAlternates,
  localeCookie,
  localeForPathname,
  localeParam,
  localizedHref,
  localizedPath,
  otherLocale,
  parseLocaleCookie,
  resolveLocaleRequest,
  shouldIgnorePath,
  stripLocaleFromPath,
} from "./locales";

/**
 * The vocabulary and URL rules every surface reads (i18n.md §2).
 *
 * The expectations are written against `defaultLocale` rather than a literal, because the one
 * thing that must hold either way is the rule: the default language is the unprefixed one, and
 * every other supported language carries its own prefix. The suite itself runs pinned to
 * English (i18n.md §7), which the last case in this file states outright.
 */
const other = otherLocale(defaultLocale);
const prefixed = (path: string) => `/${other}${path === "/" ? "" : path}`;

describe("locale vocabulary", () => {
  it("runs the suite with English pinned, which is what the English copy assertions expect", () => {
    expect(defaultLocale).toBe("en");
  });

  it("recognizes exactly the supported locales", () => {
    expect(isLocale("th")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("th-TH")).toBe(false);
    expect(isLocale("TH")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(localeParam("th-TH")).toBeUndefined();
  });

  it("puts the locale in the route's own parameter, and never for the default language", () => {
    expect(localeParam(other)).toBe(other);
    expect(localeParam(defaultLocale)).toBeUndefined();
  });
});

describe("locale in a pathname", () => {
  it("reads a prefix, and the default language has none", () => {
    expect(stripLocaleFromPath(prefixed("/catalog"))).toBe("/catalog");
    expect(stripLocaleFromPath(prefixed("/"))).toBe("/");
    expect(stripLocaleFromPath("/catalog")).toBe("/catalog");
  });

  it("localizes a path in either language", () => {
    expect(localizedPath("/catalog", defaultLocale)).toBe("/catalog");
    expect(localizedPath("/catalog", other)).toBe(prefixed("/catalog"));
    expect(localizedPath("/", other)).toBe(prefixed("/"));
    // A path that already carries the other language is not double-prefixed.
    expect(localizedPath(prefixed("/catalog"), defaultLocale)).toBe("/catalog");
  });

  it("never prefixes the signed-in work areas", () => {
    for (const path of ["/library", "/jobs", `/settings/account`, `/novels/abc/glossary`]) {
      expect(shouldIgnorePath(path)).toBe(true);
      expect(localizedPath(path, other)).toBe(path);
    }
    expect(shouldIgnorePath("/catalog")).toBe(false);
    expect(shouldIgnorePath("/novels/abc")).toBe(false);
  });

  it("keeps the query and the fragment when it moves a link between languages", () => {
    expect(localizedHref("/catalog?sort=title#top", other)).toBe(
      `${prefixed("/catalog")}?sort=title#top`,
    );
    // A path with no localized form has one URL in either language, so a switch there is a
    // reload in place: same path, same query, same fragment.
    expect(localizedHref("/library?page=2#shelf", other)).toBe("/library?page=2#shelf");
  });

  it("offers both languages of a page for hreflang, in SUPPORTED_LOCALES order", () => {
    const alternates = localeAlternates("/catalog");
    expect(alternates.map((alternate) => alternate.locale)).toEqual(["th", "en"]);
    expect(alternates.find((a) => a.locale === defaultLocale)?.href).toBe("/catalog");
    expect(alternates.find((a) => a.locale === other)?.href).toBe(prefixed("/catalog"));
  });
});

describe("which language a request is in", () => {
  it("reads the language out of the URL, whatever the cookie says", () => {
    expect(localeForPathname(prefixed("/catalog"), "th")).toBe(other);
    expect(localeForPathname("/catalog", "en")).toBe(defaultLocale);
  });

  it("falls back to the remembered choice only on the ignored paths", () => {
    expect(localeForPathname("/library", other)).toBe(other);
    expect(localeForPathname("/library", null)).toBe(defaultLocale);
  });
});

describe("canonicalizing an incoming request", () => {
  it("redirects a prefixed default language to the unprefixed URL", () => {
    expect(
      resolveLocaleRequest({
        pathname: `/${defaultLocale}/catalog`,
        search: "?sort=title",
        cookieHeader: null,
      }),
    ).toEqual({ redirectTo: "/catalog?sort=title", setCookie: null });
  });

  it("records the language a prefixed URL states", () => {
    expect(
      resolveLocaleRequest({ pathname: prefixed("/catalog"), search: "", cookieHeader: null }),
    ).toEqual({ redirectTo: null, setCookie: localeCookie(other) });
  });

  it("leaves a prefixed URL alone once the cookie agrees", () => {
    expect(
      resolveLocaleRequest({
        pathname: prefixed("/catalog"),
        search: "",
        cookieHeader: localeCookie(other),
      }),
    ).toEqual({ redirectTo: null, setCookie: null });
  });

  it("never leaves a prefix on an ignored path", () => {
    expect(
      resolveLocaleRequest({ pathname: prefixed("/library"), search: "", cookieHeader: null }),
    ).toEqual({ redirectTo: "/library", setCookie: null });
  });

  it("does nothing to a canonical reading URL", () => {
    expect(resolveLocaleRequest({ pathname: "/catalog", search: "", cookieHeader: null })).toEqual({
      redirectTo: null,
      setCookie: null,
    });
  });
});

describe("the locale cookie", () => {
  it("round-trips, and is readable on every path", () => {
    const cookie = localeCookie(other);
    expect(cookie).toContain(`${LOCALE_COOKIE}=${other}`);
    expect(cookie).toContain("Path=/");
    expect(parseLocaleCookie(`theme=dark; ${cookie}`)).toBe(other);
  });

  it("ignores a value that is not a supported locale", () => {
    expect(parseLocaleCookie(`${LOCALE_COOKIE}=th-TH`)).toBeNull();
    expect(parseLocaleCookie("")).toBeNull();
  });
});
