import { Badge } from "@/components/ui/badge";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";

export function StatusBadge({ status }: { status: JobHistoryStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="border-border bg-muted/60 text-muted-foreground">
          Pending
        </Badge>
      );
    case "running":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        >
          <span
            className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
            aria-hidden="true"
          />
          Running
        </Badge>
      );
    case "done":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          Completed
        </Badge>
      );
    case "error":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return (
        <Badge variant="outline" className="border-border text-muted-foreground">
          Cancelled
        </Badge>
      );
  }
}
