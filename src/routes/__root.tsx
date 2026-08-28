import { useEffect, useState } from "react";
import { type AnyRouteMatch, type RouterManagedTag } from "@tanstack/router-core";
import {
  Asset,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useTags,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles/globals.css?inline";
import sofiaSansUrl from "@fontsource-variable/sofia-sans/files/sofia-sans-latin-wght-normal.woff2?url";

import { getSession } from "../lib/auth/functions";
import { getConsent, useConsent } from "@/lib/consent";
import { captureException, updatePostHogConsent } from "../lib/posthog";
import { ConsentBanner } from "@/components/consent-banner";
import { NotFoundPage } from "@/components/not-found-page";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

type DevtoolsModule = typeof import("@tanstack/react-devtools");
type RouterDevtoolsModule = typeof import("@tanstack/react-router-devtools");
type QueryDevtoolsModule = typeof import("../integrations/tanstack-query/devtools");

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
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: sofiaSansUrl,
        fetchPriority: "low",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootDocument,
});

function DevelopmentDevtools() {
  const [devtools, setDevtools] = useState<React.ReactNode>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@tanstack/react-devtools"),
      import("@tanstack/react-router-devtools"),
      import("../integrations/tanstack-query/devtools"),
    ])
      .then(
        ([reactDevtools, routerDevtools, queryDevtools]: [
          DevtoolsModule,
          RouterDevtoolsModule,
          QueryDevtoolsModule,
        ]) => {
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
        },
      )
      .catch((error: unknown) => {
        if (cancelled) return;
        captureException(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return devtools;
}

function HeadContentWithoutModulePreloads() {
  const tags = useTags();

  return (
    <>
      {tags
        .filter((tag) => tag.tag !== "link" || tag.attrs?.rel !== "modulepreload")
        .map((tag) => (
          <Asset
            key={`${tag.tag}-${tag.attrs?.rel ?? ""}-${tag.attrs?.href ?? ""}-${tag.attrs?.name ?? ""}-${tag.attrs?.property ?? ""}`}
            {...tag}
          />
        ))}
    </>
  );
}

type ScriptRenderAsset = RouterManagedTag & {
  preventScriptHoist?: boolean;
};

function DeferredScripts() {
  const router = useRouter();
  const matches = useRouterState({ select: (state) => state.matches });
  const nonce = router.options.ssr?.nonce;
  const getAssetScripts = (matches: AnyRouteMatch[]) => {
    const assetScripts: ScriptRenderAsset[] = [];
    const manifest = router.ssr?.manifest;

    if (!manifest) {
      return [];
    }

    for (const match of matches) {
      const scripts = manifest.routes[match.routeId]?.scripts;

      if (!scripts) {
        continue;
      }

      for (const asset of scripts) {
        const src = typeof asset.attrs?.src === "string" ? asset.attrs.src : null;
        assetScripts.push(
          src
            ? {
                tag: "script",
                attrs: {
                  ...asset.attrs,
                  src: undefined,
                  async: false,
                  defer: undefined,
                  fetchPriority: undefined,
                  nonce,
                },
                children: `const load = () => import(${JSON.stringify(src)}); if (typeof requestAnimationFrame === "function") { requestAnimationFrame(() => setTimeout(load, 250)); } else { setTimeout(load, 250); }`,
              }
            : {
                tag: "script",
                attrs: { ...asset.attrs, async: false, defer: true, nonce },
                children: asset.children,
                preventScriptHoist: true,
              },
        );
      }
    }

    return assetScripts;
  };

  const getScripts = (matches: AnyRouteMatch[]) =>
    matches
      .map((match) => match.scripts)
      .flat(1)
      .filter((script): script is RouterManagedTag => Boolean(script))
      .map(
        ({ children, ...script }) =>
          ({
            tag: "script",
            attrs: {
              ...script,
              suppressHydrationWarning: true,
              nonce,
            },
            children,
          }) satisfies RouterManagedTag,
      );

  const assetScripts = getAssetScripts(matches);
  const scripts = getScripts(matches);

  const allScripts = [...scripts, ...assetScripts];

  if ((typeof window === "undefined" || router.isServer) && router.serverSsr) {
    const serverBufferedScript = router.serverSsr.takeBufferedScripts();
    if (serverBufferedScript) {
      allScripts.unshift(serverBufferedScript);
    }
  }

  return (
    <>
      {allScripts.map((asset, index) => (
        <Asset {...asset} key={`tsr-scripts-${asset.tag}-${index}`} />
      ))}
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { consent } = useConsent();

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
    <html lang="en" suppressHydrationWarning>
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
          {children}
          <Toaster />
          <ConsentBanner />
        </ThemeProvider>
        {import.meta.env.DEV && <DevelopmentDevtools />}
        <DeferredScripts />
      </body>
    </html>
  );
}
