import posthog from "posthog-js";

export function initPostHog() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  const key = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!key) return;

  posthog.init(key, {
    defaults: '2026-05-30',
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: true,
    capture_exceptions: true,
  });

  posthog.capture('my_custom_event', { property: 'value' })
}

export { posthog };
