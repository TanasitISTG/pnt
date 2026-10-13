import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & { variant?: "default" | "compact" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface-0 px-3 py-1.5 text-body transition-colors duration-micro outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-caption file:text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        variant === "compact" && "h-9 text-caption",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
