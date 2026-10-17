import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import type { ChapterStatus } from "@/components/chapters/types";

interface ChapterStatusBadgeProps {
  status: ChapterStatus;
}

/**
 * A chapter's state, as the owner reads it in the table. Each branch names its own catalog
 * key rather than deriving one, so a renamed state cannot silently lose its words.
 */
export function ChapterStatusBadge({ status }: ChapterStatusBadgeProps) {
  const t = useTranslations("studio");
  switch (status) {
    case "raw":
      return (
        <Badge variant="mutedOutline" className="capitalize">
          {t("statusRaw")}
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="info" className="capitalize font-medium">
          {t("statusQueued")}
        </Badge>
      );
    case "translating":
      return (
        <Badge variant="warningSubtle" className="capitalize font-medium motion-safe:animate-pulse">
          {t("statusTranslating")}
        </Badge>
      );
    case "translated":
      return (
        <Badge variant="successSubtle" className="capitalize font-medium">
          {t("statusTranslated")}
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="capitalize font-medium">
          {t("statusError")}
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
