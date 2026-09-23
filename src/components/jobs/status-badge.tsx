import { Badge } from "@/components/ui/badge";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";

export function StatusBadge({ status }: { status: JobHistoryStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="muted">Pending</Badge>;
    case "running":
      return (
        <Badge variant="warning">
          <span
            className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
            aria-hidden="true"
          />
          Running
        </Badge>
      );
    case "done":
      return <Badge variant="success">Completed</Badge>;
    case "error":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="mutedOutline">Cancelled</Badge>;
  }
}
