import { useEffect } from "react";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { Home, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { posthog } from "@/lib/posthog";

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    if (error) {
      posthog.captureException(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
        <TriangleAlert className="size-7 text-muted-foreground" />
      </div>
      <h1 className="text-card-title font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-body text-muted-foreground">
        {import.meta.env.DEV && error?.message
          ? error.message
          : "An unexpected error occurred. Please try again or return to the library."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => (reset ? reset() : window.location.reload())}>
          <RefreshCw className="size-4" />
          Try again
        </Button>
        <Button variant="outline" render={<Link to="/" />}>
          <Home className="size-4" />
          Back to Library
        </Button>
      </div>
    </div>
  );
}
