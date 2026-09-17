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
        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
          <span
            className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
            aria-hidden="true"
          />
          Running
        </Badge>
      );
    case "done":
      return (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
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
