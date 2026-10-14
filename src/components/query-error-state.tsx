import { useTranslations } from "use-intl";

import { ErrorState } from "@/components/ui/error-state";

interface QueryErrorStateProps {
  title?: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
  /** `panel` is a single tinted row for a failed section inside a working page. */
  variant?: "page" | "panel";
}

/**
 * The query-failure case keeps its own name so every existing caller stays put; the
 * treatment itself is the shared ErrorState, so a failed read looks the same wherever it
 * happens. It also keeps the reader's word for the action — a failed *read* is retried,
 * and the label is part of what callers and tests already depend on.
 */
export function QueryErrorState({
  title,
  error,
  onRetry,
  className = "my-8",
  variant = "page",
}: QueryErrorStateProps) {
  const t = useTranslations("errors");
  return (
    <ErrorState
      variant={variant}
      title={title ?? t("queryFailed")}
      error={error}
      onRetry={onRetry}
      className={className}
    />
  );
}
