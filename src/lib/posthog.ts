import type { PostHog } from "posthog-js";

import { getConsent, type ConsentState } from "@/lib/consent";

let initialized = false;
let clientPromise: Promise<PostHog | null> | null = null;
let client: PostHog | null = null;

function canUsePostHog() {
  return typeof window !== "undefined" && import.meta.env.PROD && getConsent() === "granted";
}

async function getPostHogClient() {
  if (!canUsePostHog()) return null;
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = import("posthog-js").then((module) => {
    const key =
      import.meta.env.VITE_PUBLIC_POSTHOG_KEY ?? import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
    if (!key) return null;

    const host =
      import.meta.env.VITE_PUBLIC_POSTHOG_HOST ??
      import.meta.env.VITE_POSTHOG_HOST ??
      "https://us.i.posthog.com";

    const posthog = module.default;
    if (!initialized) {
      posthog.init(key, {
        api_host: host,
        capture_pageview: true,
        capture_exceptions: false,
        capture_performance: false,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        disable_surveys: true,
        disable_product_tours: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        persistence: "localStorage+cookie",
        autocapture: false,
        disable_session_recording: true,
      });
      initialized = true;
    }
    client = posthog;
    return posthog;
  });

  return clientPromise;
}

export async function updatePostHogConsent(consent: ConsentState) {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;

  if (consent === "granted") {
    const posthog = await getPostHogClient();
    posthog?.opt_in_capturing();
    return;
  }

  if (initialized && client) {
    client.opt_out_capturing();
  }
}

export function captureException(error: unknown) {
  if (getConsent() !== "granted") return;
  void getPostHogClient().then((posthog) => posthog?.captureException(error));
}
