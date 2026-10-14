import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/profile` was the account page before settings became a hub. The URL still resolves,
 * so old links, bookmarks and the email-change and social-link callbacks keep working —
 * they land on the account section, which is where the same cards live now.
 */
export const Route = createFileRoute("/_protected/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/account", replace: true });
  },
});
