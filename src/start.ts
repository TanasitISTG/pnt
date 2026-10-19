import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

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
 * The origin gate for server function endpoints.
 *
 * A server function is a same-origin RPC endpoint with no page around it: the framework's own
 * client serializes the call, and nothing else legitimately posts to `/_serverFn/*`. Without a
 * check here, a request minted by another site reached the handler — a form-encoded post is a
 * "simple" request, so the browser sends it without a preflight, and the endpoint answers 200
 * (verified against a cross-site Origin before this was added). Session cookies are the only
 * thing that made that mostly harmless, through Better Auth's default `SameSite=Lax`, and a
 * workaround for `SameSite` is exactly the kind of change that would silently turn the gap into
 * an exploitable one.
 *
 * So the framework's middleware, filtered to `serverFn` requests only: route loads are pages
 * the browser navigates to directly, and they are not the thing being forged. It accepts the
 * request's own origin (via `Sec-Fetch-Site`, then `Origin`, then `Referer`) and refuses
 * everything else with a 403 before the function runs. A non-browser caller that sends none of
 * those headers is refused too, which is the correct default: this endpoint's client is the
 * app, not the network at large.
 *
 * It comes first so a forged request is refused before the locale middleware does any work.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Start's own configuration, discovered at `src/start.ts` by the framework.
 *
 * `requestMiddleware` is the supported shape in this version. The older recipe wrapped a
 * custom server entry around the handler, which would mean owning the render pipeline to
 * change one header, and this does the same work before any route is matched.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, localeRequestMiddleware],
}));
