import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { ErrorPage } from "@/components/error-page";

export const Route = createFileRoute("/_protected")({
  beforeLoad: ({ context, location }) => {
    if (!context.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    return { user: context.user };
  },
  errorComponent: (props) => {
    const location = useLocation();
    const error = props.error as any;
    if (
      error?.name === "UnauthorizedError" ||
      error?.message === "Unauthorized" ||
      error?.cause?.name === "UnauthorizedError"
    ) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    return <ErrorPage {...props} />;
  },
  head: () => ({
    meta: [
      {
        name: "robots",
        content: "noindex, nofollow",
      },
    ],
  }),
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
