import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

function Spinner({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"svg"> & { variant?: "default" | "primary" | "muted" }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        "size-4 animate-spin",
        variant === "primary" && "text-primary",
        variant === "muted" && "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
