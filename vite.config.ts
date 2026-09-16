import { defineConfig } from "vitest/config";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Nitro is the deploy server — useless in unit tests, and its Vercel
// env-runner probes the SSR module graph on startup, which crashes on CJS
// react ("module is not defined") and warns about VERCEL_OIDC_TOKEN.
const isVitest = !!process.env.VITEST;

const config = defineConfig(({ command }) => {
  // A host-level NODE_ENV=production selects the production env schema, which
  // requires Inngest Cloud keys, and every SSR module load then fails with a
  // ZodError. Vitest pins its own value through `test.env` below.
  if (command === "serve" && !isVitest) process.env.NODE_ENV = "development";

  return {
    build: { target: "es2022" },
    resolve: { tsconfigPaths: true },
    test: {
      setupFiles: ["./src/test/setup.ts"],
      // React resolves its production build from an inherited NODE_ENV, which
      // breaks every render test ("React.act is not a function").
      env: { NODE_ENV: "test" },
    },
    plugins: [
      devtools(),
      !isVitest &&
        nitro({
          preset: "vercel",
          routeRules: {
            "/**": {
              headers: {
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "strict-origin-when-cross-origin",
                "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
                "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
              },
            },
          },
        }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  };
});

export default config;
