import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { defaultLocale, isLocale } from "@/lib/i18n/locales";

/**
 * The layout that carries a language in the URL.
 *
 * The parameter is optional, which is what makes one route definition serve both `/catalog`
 * (the default language, unprefixed) and `/en/catalog`. A segment that is not a language is
 * not a page: `/xx/catalog` is a 404 rather than a catalog in a language nobody speaks,
 * which is also what stops a future `/essays` from being read as one.
 *
 * `locale` is published as route context so nothing below has to re-derive it, and the
 * provider here is what makes the URL, rather than the document that is already on screen,
 * the authority for the subtree.
 */
export const Route = createFileRoute("/{-$locale}")({
  beforeLoad: ({ params }) => {
    if (params.locale !== undefined && !isLocale(params.locale)) throw notFound();
    return { locale: params.locale ?? defaultLocale };
  },
  component: LocalizedLayout,
});

function LocalizedLayout() {
  const { locale } = Route.useRouteContext();

  return (
    <I18nProvider locale={locale}>
      <Outlet />
    </I18nProvider>
  );
}
