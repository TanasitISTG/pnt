import { useEffect } from "react";
import { Link, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { QuietPage } from "@/components/quiet-page";
import { QuietShell, hasPageFrame } from "@/components/shell/quiet-shell";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/posthog";

/**
 * The screen a thrown route error lands on, both as the router's default and for every
 * route that does not override it.
 *
 * The copy states what happened and what to do next, and it says the reassuring thing that
 * is true: a failed load is not a lost write. The thrown message is surfaced only in
 * development, because a redirect, a not-found or a server refusal is not a defect and its
 * wording is written for a caller, not a reader.
 */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const errorMessage = error instanceof Error ? error.message : undefined;
  const framed = useRouterState({
    select: (state) => hasPageFrame(state.matches.map((match) => match.routeId)),
  });

  useEffect(() => {
    if (error) {
      captureException(error);
    }
  }, [error]);

  const page = (
    <QuietPage
      icon={<TriangleAlert />}
      title="This page did not load"
      description={
        import.meta.env.DEV && errorMessage
          ? errorMessage
          : "The request did not finish, so the page is incomplete. Trying again usually works, and nothing you have saved is affected."
      }
    >
      <Button onClick={() => (reset ? reset() : window.location.reload())}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </Button>
      <Button variant="outline" render={<Link to="/catalog" />}>
        Back to catalog
      </Button>
    </QuietPage>
  );

  return framed ? page : <QuietShell>{page}</QuietShell>;
}
