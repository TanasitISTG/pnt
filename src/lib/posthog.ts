import posthog from "posthog-js";

import { getConsent, type ConsentState } from "@/lib/consent";

export function initPostHog() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
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
  });

  if (consent === "denied") {
    posthog.opt_out_capturing();
  }
}

// ponytail: module flag skips the first updatePostHogConsent call — initPostHog()
// already inits with the right config on mount; only mid-session changes need reset+re-init.
let consentInitialized = false;

export function updatePostHogConsent(consent: ConsentState) {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;

  if (!consentInitialized) {
    consentInitialized = true;
    return;
  }

  if (consent === "granted") {
    // opt_in_capturing alone doesn't flip persistence post-init; reset + re-init
    // upgrades from "memory" to "localStorage+cookie" for cross-session distinct_id.
    posthog.reset();
    initPostHog();
  } else if (consent === "denied") {
    posthog.opt_out_capturing();
  }
}

export { posthog };
