import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Actions, or anything else that lets the reader leave the empty state. */
  children?: React.ReactNode;
  className?: string;
  /** `compact` fits inside a panel or a card; `default` owns a page region. */
  size?: "default" | "compact";
}

/**
 * An empty screen is an invitation to act, not a mood: a plain centred block with one
 * explanation and one obvious next step. No dashed container, no illustration — the
 * card the state sits in already provides the boundary.
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  size = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "default" ? "gap-3 px-6 py-20" : "gap-2.5 px-5 py-10",
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-1 flex size-11 items-center justify-center rounded-xl bg-surface-inset text-muted-foreground [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <h2
        className={
          size === "default" ? "text-sub text-foreground" : "text-card-title text-foreground"
        }
      >
        {title}
      </h2>
      {description ? (
        <p className="max-w-md text-body text-muted-foreground">{description}</p>
      ) : null}
      {children ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
