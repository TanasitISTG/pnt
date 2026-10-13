import * as React from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  /** A replacement for the thrown message when the caller knows better copy. */
  description?: React.ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  /** `panel` is a single tinted row for a failed section inside a working page. */
  variant?: "page" | "panel";
}

/**
 * Failure states say what did not happen and offer the retry, in the interface's voice.
 * The thrown message is surfaced only when the server chose to make it safe
 * (`withSafeHandler`); unknown failures fall back to the generic sentence.
 */
export function ErrorState({
  title = "That didn't load",
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  className,
  variant = "page",
}: ErrorStateProps) {
  const thrown = error instanceof Error ? error.message : undefined;
  const message = description ?? thrown ?? "The request did not complete. Try again.";

  if (variant === "panel") {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-body",
          className,
        )}
      >
        <p className="flex min-w-0 items-center gap-2 text-destructive-text">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{message}</span>
        </p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <div
        className="mb-1 flex size-11 items-center justify-center rounded-xl bg-destructive/8 text-destructive-text"
        aria-hidden="true"
      >
        <TriangleAlert className="size-5" />
      </div>
      <h2 className="text-sub text-foreground">{title}</h2>
      <p className="max-w-md text-body text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-2" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
