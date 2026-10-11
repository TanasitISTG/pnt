import { useRouteContext } from "@tanstack/react-router";

import type { ResolvedAvatar } from "./types";

/**
 * The root route resolves the photo once per navigation, so the header reads it
 * from context instead of every shell call site threading another prop.
 */
export function useViewerAvatar(): ResolvedAvatar | null {
  return useRouteContext({ from: "__root__" }).avatar ?? null;
}
