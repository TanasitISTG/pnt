import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The hub opens on the account section: it is the part of settings a reader arrives for,
 * and a bare `/settings` should never be a dead end.
 */
export const Route = createFileRoute("/_protected/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/account", replace: true });
  },
});
