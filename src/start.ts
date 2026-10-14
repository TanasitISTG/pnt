import { createMiddleware, createStart } from "@tanstack/react-start";

import { resolveLocaleRequest } from "@/lib/i18n/locales";

/**
 * The one place a language is added to, or taken off, a URL before anything renders.
 *
 * Two canonicalizations, both permanent redirects: the default language never keeps its
 * prefix, and a prefix never sticks to a path that has no localized form. Neither is a
 * language negotiation: a reading surface answers in the language its URL names, whatever
 * the cookie or the browser says, because that is what makes the URL worth sharing and the
 * sitemap worth crawling. The cookie is only recorded from a URL that already states a
 * language, so the reader's own choice follows them into the signed-in areas.
 *
 * Server function calls are left alone: their URL is an RPC endpoint, not a page.
 */
const localeRequestMiddleware = createMiddleware().server(
  async ({ request, next, handlerType }) => {
    if (handlerType !== "router") return next();

    const url = new URL(request.url);
    const decision = resolveLocaleRequest({
      pathname: url.pathname,
      search: url.search,
      cookieHeader: request.headers.get("cookie"),
    });

    if (decision.redirectTo) {
      return new Response(null, {
        status: 301,
        headers: { Location: decision.redirectTo, "Cache-Control": "no-store" },
      });
    }

    const resolved = await next();
    if (decision.setCookie) resolved.response.headers.append("Set-Cookie", decision.setCookie);
    return resolved;
  },
);

/**
 * Start's own configuration, discovered at `src/start.ts` by the framework.
 *
 * `requestMiddleware` is the supported shape in this version. The older recipe wrapped a
 * custom server entry around the handler, which would mean owning the render pipeline to
 * change one header, and this does the same work before any route is matched.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [localeRequestMiddleware],
}));
