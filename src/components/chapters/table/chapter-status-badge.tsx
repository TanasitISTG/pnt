import { Badge } from "@/components/ui/badge";
import type { ChapterStatus } from "@/components/chapters/types";

interface ChapterStatusBadgeProps {
  status: ChapterStatus;
}

export function ChapterStatusBadge({ status }: ChapterStatusBadgeProps) {
  switch (status) {
    case "raw":
      return (
        <Badge variant="outline" className="border-border text-muted-foreground capitalize">
          Raw
        </Badge>
      );
    case "queued":
      return (
        <Badge
          variant="outline"
          className="bg-info/10 text-info border-info/20 capitalize font-medium"
        >
          Queued
        </Badge>
      );
    case "translating":
      return (
        <Badge
          variant="outline"
          className="bg-warning/10 text-warning border-warning/20 capitalize font-medium animate-pulse"
        >
          Translating
        </Badge>
      );
    case "translated":
      return (
        <Badge
          variant="outline"
          className="bg-success/10 text-success border-success/20 capitalize font-medium"
        >
          Translated
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="capitalize font-medium">
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="capitalize">
          {status}
        </Badge>
      );
  }
}
