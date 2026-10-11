/**
 * Client helpers for Cloudflare Turnstile.
 *
 * The Better Auth captcha plugin verifies the challenge server-side and reads the
 * answer from the `x-captcha-response` header, so the browser only has to solve the
 * widget and hand the token back with the request.
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
  /** Controls *visibility*, not execution: "interaction-only" reveals the widget only
   * when Cloudflare decides the visitor has to act. */
  appearance?: "always" | "execute" | "interaction-only";
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Request options carrying the challenge answer. Omitting the header entirely when
 * there is no token lets a deployment without Turnstile talk to the same endpoints
 * unchanged.
 */
export function captchaFetchOptions(
  token: string | null,
): { headers: Record<string, string> } | undefined {
  return token ? { headers: { "x-captcha-response": token } } : undefined;
}
