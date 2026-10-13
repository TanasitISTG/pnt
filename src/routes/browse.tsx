import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/browse` was the shared catalog before `/catalog` existed. The URL still resolves,
 * query string included, so old links and bookmarks keep their filters.
 */
export const Route = createFileRoute("/browse")({
  beforeLoad: ({ location }) => {
    const queryIndex = location.href.indexOf("?");
    const suffix = queryIndex === -1 ? "" : location.href.slice(queryIndex);
    throw redirect({ href: `/catalog${suffix}`, replace: true });
  },
});
