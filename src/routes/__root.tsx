import { useEffect, useState } from "react";
import { Asset, createRootRouteWithContext, Scripts, useTags } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { createTranslator } from "use-intl/core";
import { Toaster } from "@/components/ui/sonner";
import { useOverlayScrollLockRecovery } from "@/components/ui/overlay-scroll-lock";

import appCss from "../styles/globals.css?inline";
import sofiaSansUrl from "@fontsource-variable/sofia-sans/files/sofia-sans-latin-wght-normal.woff2?url";

import { getViewerProfile } from "@/lib/profile/functions";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { resolveDocumentLocale } from "@/lib/i18n/request-locale";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";
import { MotionProvider } from "@/components/motion/motion-provider";
import { getConsent, useConsent } from "@/lib/consent";
import { captureException, updatePostHogConsent } from "../lib/posthog";
import { ConsentBanner } from "@/components/consent-banner";
import { NotFoundPage } from "@/components/not-found-page";

import type { QueryClient } from "@tanstack/react-query";
import type { ViewerProfile } from "@/lib/profile/types";

interface MyRouterContext {
  queryClient: QueryClient;
}

type DevtoolsModule = typeof import("@tanstack/react-devtools");
type RouterDevtoolsModule = typeof import("@tanstack/react-router-devtools");
type QueryDevtoolsModule = typeof import("../integrations/tanstack-query/devtools");

export const Route = createRootRouteWithContext<MyRouterContext>()({
  notFoundComponent: NotFoundPage,
  beforeLoad: async () => {
    const viewer = await getViewerProfile();
    const locale = await resolveDocumentLocale(rememberedLocaleOf(viewer));
    return {
      user: viewer?.user ?? null,
      avatar: viewer?.avatar ?? null,
      // Set while an operator is viewing as this account; every layout passes it to
      // the shell so the notice stands on every page, including the reader.
      impersonation: viewer?.impersonation ?? null,
      // The language of the document request, which the shell needs before any route
      // below it has run: the root layout, rather than a page, is what sets `lang`.
      locale,
    };
  },
  head: async () => {
    // The brand is a name, not a sentence, so only the description is translated here. A
    // page that has something more specific to say sets its own title and description.
    // No viewer is read here: a second session lookup on every render would buy the
    // ignored paths a better `og:locale` on a page that is never shared.
    const locale = await resolveDocumentLocale(null);
    const t = createTranslator({ locale, messages: messages[locale] });
    const siteName = t("meta.siteName");
    const description = t("meta.siteDescription");
    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: siteName,
        },
        {
          name: "description",
          content: description,
        },
        {
          property: "og:site_name",
          content: siteName,
        },
        {
          property: "og:type",
          content: "website",
        },
        {
          property: "og:locale",
          content: locale === "th" ? "th_TH" : "en_US",
        },
        {
          name: "twitter:card",
          content: "summary",
        },
        {
          name: "twitter:title",
          content: siteName,
        },
        {
          name: "twitter:description",
          content: description,
        },
      ],
      links: [
        {
          rel: "icon",
          type: "image/png",
          href: "/favicon.png",
        },
        {
          rel: "apple-touch-icon",
          href: "/logo-256.png",
        },
        {
          rel: "manifest",
          href: "/manifest.json",
        },
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: sofiaSansUrl,
          fetchPriority: "low",
          crossOrigin: "anonymous",
        },
      ],
    };
  },
  shellComponent: RootDocument,
});

/**
 * The language a signed-in account chose, which only the ignored paths consult.
 *
 * The stored value is whatever a session once wrote, so it is parsed rather than trusted: a
 * value that is not a supported locale is simply no preference.
 */
function rememberedLocaleOf(viewer: ViewerProfile | null): Locale | null {
  const stored = viewer?.user.locale;
  return isLocale(stored) ? stored : null;
}

function DevelopmentDevtools() {
  const [devtools, setDevtools] = useState<React.ReactNode>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [reactDevtools, routerDevtools, queryDevtools] = (await Promise.all([
          import("@tanstack/react-devtools"),
          import("@tanstack/react-router-devtools"),
          import("../integrations/tanstack-query/devtools"),
        ])) as [DevtoolsModule, RouterDevtoolsModule, QueryDevtoolsModule];
        if (cancelled) return;
        const TanStackDevtools = reactDevtools.TanStackDevtools;
        const TanStackRouterDevtoolsPanel = routerDevtools.TanStackRouterDevtoolsPanel;
        const TanStackQueryDevtools = queryDevtools.default;
        setDevtools(
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />,
        );
      } catch (error: unknown) {
        if (cancelled) return;
        captureException(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return devtools;
}

function HeadContentWithoutModulePreloads() {
  const tags = useTags();

  const assets: React.ReactNode[] = [];
  for (const tag of tags) {
    if (tag.tag === "link" && tag.attrs?.rel === "modulepreload") continue;
    assets.push(
      <Asset
        key={`${tag.tag}-${tag.attrs?.rel ?? ""}-${tag.attrs?.href ?? ""}-${tag.attrs?.name ?? ""}-${tag.attrs?.property ?? ""}`}
        {...tag}
      />,
    );
  }

  return <>{assets}</>;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { consent } = useConsent();
  const { locale } = Route.useRouteContext();
  // A popup gives the page back when it closes; this is the guarantee that it does, even
  // when a lock outlives the popup that took it, and the audit that names the popup.
  useOverlayScrollLockRecovery();

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (getConsent() === "granted" && event.reason) {
        captureException(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
        );
      }
    };

    const handleError = (event: ErrorEvent) => {
      if (getConsent() === "granted" && event.error) {
        captureException(event.error instanceof Error ? event.error : new Error(event.message));
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  useEffect(() => {
    if (consent === "granted") {
      const timer = window.setTimeout(() => {
        void updatePostHogConsent("granted");
      }, 5000);
      return () => window.clearTimeout(timer);
    }

    void updatePostHogConsent(consent);
  }, [consent]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContentWithoutModulePreloads />
        <style dangerouslySetInnerHTML={{ __html: appCss }} />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider locale={locale}>
            <MotionProvider>
              {children}
              <Toaster />
              <ConsentBanner />
            </MotionProvider>
          </I18nProvider>
        </ThemeProvider>
        {import.meta.env.DEV && <DevelopmentDevtools />}
        <Scripts />
      </body>
    </html>
  );
}
