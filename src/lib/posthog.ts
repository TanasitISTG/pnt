import posthog from "posthog-js";

import { getConsent, type ConsentState } from "@/lib/consent";

// ponytail: module flag makes initPostHog idempotent — PostHog throws a no-op
// warning when posthog.init() is called twice, and TanStack Start hydration can
// run RootDocument effects more than once per mount. Guarding init is safer
// than re-init attempts: persistence can't upgrade mid-session once PostHog is
// alive (would need reset+reload). Acceptance mid-session uses opt_in instead;
// cross-session identity for the first post-accept session is lost but cheap
// (single admin, analytics noise only).
let initialized = false;

export function initPostHog() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  if (initialized) return;
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY ?? import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!key) return;

  const host =
    import.meta.env.VITE_PUBLIC_POSTHOG_HOST ??
    import.meta.env.VITE_POSTHOG_HOST ??
    "https://us.i.posthog.com";

  const consent = getConsent();

  posthog.init(key, {
    api_host: host,
    capture_pageview: consent === "granted",
    capture_exceptions: consent === "granted",
    opt_out_capturing_by_default: consent !== "granted",
    persistence: consent === "granted" ? "localStorage+cookie" : "memory",
    // PostHog Cloud project has autocapture + session recording enabled in the
    // dashboard; leaving them on per user request. The sub-scripts the SDK
    // lazily loads from us-assets.i.posthog.com may trip CORS errors on networks
    // with third-party tracker blocking (Firefox ETP) — out of app control.
    autocapture: true,
    disable_session_recording: false,
  });

  if (consent === "denied") {
    posthog.opt_out_capturing();
  }
  initialized = true;
}

export function updatePostHogConsent(consent: ConsentState) {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  if (!initialized) return;

  if (consent === "granted") {
    posthog.opt_in_capturing();
  } else if (consent === "denied") {
    posthog.opt_out_capturing();
  }
}

export { posthog };
