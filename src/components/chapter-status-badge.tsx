import type { chapterStatusEnum } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";

type ChapterStatus = (typeof chapterStatusEnum.enumValues)[number];

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
          className="bg-blue-500/10 text-blue-600 border-blue-500/20 capitalize font-medium"
        >
          Queued
        </Badge>
      );
    case "translating":
      return (
        <Badge
          variant="outline"
          className="bg-amber-500/10 text-amber-600 border-amber-500/20 capitalize font-medium animate-pulse"
        >
          Translating
        </Badge>
      );
    case "translated":
      return (
        <Badge
          variant="outline"
          className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 capitalize font-medium"
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
