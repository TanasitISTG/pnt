import { Badge } from "@/components/ui/badge";
import type { ChapterStatus } from "@/components/chapters/types";

interface ChapterStatusBadgeProps {
  status: ChapterStatus;
}

export function ChapterStatusBadge({ status }: ChapterStatusBadgeProps) {
  switch (status) {
    case "raw":
      return (
        <Badge variant="mutedOutline" className="capitalize">
          Raw
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="info" className="capitalize font-medium">
          Queued
        </Badge>
      );
    case "translating":
      return (
        <Badge variant="warningSubtle" className="capitalize font-medium animate-pulse">
          Translating
        </Badge>
      );
    case "translated":
      return (
        <Badge variant="successSubtle" className="capitalize font-medium">
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
