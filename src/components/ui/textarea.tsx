import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: "default" | "code" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:shadow-ring-blue disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        variant === "code" && "font-mono text-xs",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
