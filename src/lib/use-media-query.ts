import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as React state.
 *
 * `matchMedia` is already an external store, so the browser's own `change` event is the
 * subscription and nothing has to re-measure on render. It exists for the one decision
 * CSS cannot make for us: which edge an overlay travels from. A panel is `side="end"` on
 * a pointer screen and `side="bottom"` under a thumb, and the primitive takes that as a
 * prop rather than a media query of its own.
 *
 * The server snapshot is `false` on purpose: the only callers are overlays, which mount
 * after a press, so there is no server-rendered first paint for the answer to disagree
 * with.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** `md` and up: the width at which `side="end"` replaces `side="bottom"`. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
