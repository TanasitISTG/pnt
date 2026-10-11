import { useEffect, useRef } from "react";

import { TURNSTILE_SCRIPT_SRC } from "@/lib/auth/captcha";

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string | null) => void;
  theme?: "light" | "dark" | "auto";
  className?: string;
}

const SCRIPT_MARKER = "data-pnt-turnstile";

/**
 * Renders the Cloudflare Turnstile challenge and reports the answer token.
 *
 * The script is injected once and shared by every widget on the page, because
 * loading it twice makes the second load a no-op and leaves the widget unrendered.
 * `onToken(null)` on expiry and error is deliberate: a stale or missing token must
 * disable submission rather than send a value the server will reject.
 *
 * `appearance: "interaction-only"` hides the 65px challenge frame unless Cloudflare
 * actually needs a click. It is a visibility setting, not an execution one: the
 * managed challenge still runs and still issues its token with the frame hidden, so a
 * form that renders a token-gated submit button is unaffected — only the readers who
 * are asked to tick a box see the box, and the frame then appears in place.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  theme = "auto",
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Held in a ref so an inline callback prop cannot retrigger the effect and
  // re-render the widget on every keystroke in the surrounding form.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    const render = () => {
      if (disposed || widgetIdRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme,
        size: "flexible",
        appearance: "interaction-only",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
        "timeout-callback": () => onTokenRef.current(null),
      });
    };

    let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
    if (!script) {
      script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.setAttribute(SCRIPT_MARKER, "true");
      document.head.appendChild(script);
    }

    const handleLoad = () => render();
    if (window.turnstile) render();
    else script.addEventListener("load", handleLoad);
    // A script cached from a previous page can finish before this effect runs.
    const poll = window.setInterval(() => {
      if (window.turnstile) {
        render();
        window.clearInterval(poll);
      }
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      script?.removeEventListener("load", handleLoad);
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId) window.turnstile?.remove(widgetId);
      onTokenRef.current(null);
    };
  }, [siteKey, theme]);

  return <div ref={containerRef} className={className} />;
}
