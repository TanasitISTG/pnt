import { useTranslations } from "use-intl";

import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

function Spinner({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"svg"> & { variant?: "default" | "primary" | "muted" }) {
  // The name a screen reader announces. `common.loading` is the same word the app shows while it
  // waits, so a reader who cannot see the spinner hears the state the sighted reader is told.
  const t = useTranslations("common");
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t("loading")}
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
