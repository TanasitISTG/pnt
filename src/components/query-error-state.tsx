import { Button } from "@/components/ui/button";

interface QueryErrorStateProps {
  title?: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

export function QueryErrorState({
  title = "Failed to load content",
  error,
  onRetry,
  className = "min-h-[40vh] my-8",
}: QueryErrorStateProps) {
  const message = error instanceof Error ? error.message : "An error occurred.";

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center ${className}`}
    >
      <h3 className="text-card-title font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-destructive font-medium">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
