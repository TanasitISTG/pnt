import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import type { PublicationBlock } from "@/lib/content/publish/readiness";

interface ChapterPublicationBadgeProps {
  blockers: readonly PublicationBlock[];
  /** Already readable by guests, so the chapter is costing a reader something now. */
  live: boolean;
}

/**
 * Why this chapter cannot go live yet, beside its state.
 *
 * Only the first blocker is named: a row can carry several, and the first is exactly what a
 * publish click would refuse on, so the label and the toast can never disagree. The full
 * sentence is the badge's title, where a narrow column cannot show it. Nothing is disabled
 * here — the server is the authority, and the badge exists so the refusal is expected rather
 * than discovered.
 */
export function ChapterPublicationBadge({ blockers, live }: ChapterPublicationBadgeProps) {
  const t = useTranslations("studio");
  const block = blockers[0];
  if (!block) return null;

  let detail: string;
  switch (block.reason) {
    case "translation-missing":
      detail = t("publicationBlockedMissingTranslation");
      break;
    case "translation-in-flight":
      detail = t("publicationBlockedInFlight");
      break;
    case "run-incomplete":
      detail = t("publicationBlockedIncomplete");
      break;
    case "chunk-failed":
      detail = t("publicationBlockedChunkFailed", { count: block.failedChunks ?? 0 });
      break;
    case "missing-paragraphs":
      detail = t("publicationBlockedMissingParagraphs", { count: block.missingParagraphs ?? 0 });
      break;
  }

  return (
    <Badge variant="warningSubtle" className="font-medium" title={detail}>
      {live ? t("publicationAtRisk") : detail}
    </Badge>
  );
}
