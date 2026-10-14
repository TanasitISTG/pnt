import { createFileRoute, redirect } from "@tanstack/react-router";

import { defaultLocale, localeParam, localizedHref } from "@/lib/i18n/locales";

/**
 * `/browse` was the shared catalog before `/catalog` existed. The URL still resolves,
 * query string included, so old links and bookmarks keep their filters.
 *
 * The target is built from the language this page was asked for rather than from a route
 * id, because the reader should land on the catalog of the language they arrived in.
 */
export const Route = createFileRoute("/{-$locale}/browse")({
  beforeLoad: ({ location, params }) => {
    const queryIndex = location.href.indexOf("?");
    const suffix = queryIndex === -1 ? "" : location.href.slice(queryIndex);
    throw redirect({
      href: localizedHref(`/catalog${suffix}`, localeParam(params.locale) ?? defaultLocale),
      replace: true,
    });
  },
});
