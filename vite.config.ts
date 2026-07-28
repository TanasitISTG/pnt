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

const config = defineConfig({
  resolve: { tsconfigPaths: true },
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
  test: {
    passWithNoTests: true,
  },
});

export default config;
