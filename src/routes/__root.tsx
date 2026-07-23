import { useEffect } from "react";
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

import appCss from "../styles/globals.css?url";

import { getSession } from "../lib/auth.functions";
import { getConsent, useConsent } from "@/lib/consent";
import { posthog, initPostHog, updatePostHogConsent } from "../lib/posthog";
import { ConsentBanner } from "@/components/consent-banner";
import { NotFoundPage } from "@/components/not-found-page";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  notFoundComponent: NotFoundPage,
  beforeLoad: async () => {
    const session = await getSession();
    return { user: session?.user ?? null };
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Pnt - Personal Novel Translator",
      },
      {
        name: "description",
        content: "Personal web novel translation app with side-by-side reader.",
      },
      {
        property: "og:site_name",
        content: "Pnt - Personal Novel Translator",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:title",
        content: "Pnt - Personal Novel Translator",
      },
      {
        name: "twitter:description",
        content: "Personal web novel translation app with side-by-side reader.",
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
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { consent } = useConsent();

  useEffect(() => {
    initPostHog();

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (getConsent() === "granted" && event.reason) {
        posthog.captureException(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
        );
      }
    };

    const handleError = (event: ErrorEvent) => {
      if (getConsent() === "granted" && event.error) {
        posthog.captureException(
          event.error instanceof Error ? event.error : new Error(event.message),
        );
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
    updatePostHogConsent(consent);
  }, [consent]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <ConsentBanner />
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
