import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChapterAudience } from "@/lib/analytics/types";
import { percentShare } from "@/lib/analytics/aggregate";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

/**
 * One row per chapter, ordered as the novel reads.
 *
 * `lastReached` is the number that answers "where do they stop": a reader is counted under the
 * highest chapter they finished, so the column is a distribution of stopping points rather than
 * another readers count. The share beside each readers figure is against the novel's whole
 * audience, which is what makes a thin chapter visible at a glance.
 */
export function ChapterAudienceTable({
  chapters,
  totalReaders,
}: {
  chapters: ChapterAudience[];
  totalReaders: number;
}) {
  const t = useTranslations("analytics");
  const locale = useLocale() as Locale;
  // Read once per mount rather than on every render: a scheduled chapter must not flip to
  // published mid-interaction, and the page's own staleness window is a minute anyway.
  const [now] = useState(() => Date.now());
  const stateOf = (publishedAt: Date | null) =>
    publishedAt === null
      ? t("draft")
      : new Date(publishedAt).getTime() <= now
        ? t("published")
        : t("scheduled");

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">{t("columnChapter")}</TableHead>
            <TableHead>{t("columnPublished")}</TableHead>
            <TableHead className="text-right">{t("columnReaders")}</TableHead>
            <TableHead className="text-right">{t("columnLastReached")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chapters.map((chapter) => (
            <TableRow key={chapter.chapterId}>
              <TableCell className="font-medium tabular-nums">{chapter.number}</TableCell>
              <TableCell className="max-w-[28rem]">
                <span className="block truncate text-foreground">
                  {chapter.translatedTitle ?? chapter.title}
                </span>
                <span className="block text-caption text-muted-foreground">
                  {chapter.publishedAt
                    ? `${stateOf(chapter.publishedAt)} · ${formatDate(chapter.publishedAt, locale)}`
                    : stateOf(null)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(chapter.readers, locale)}
                <span className="ml-1 text-caption text-muted-foreground">
                  · {percentShare(chapter.readers, totalReaders)}%
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(chapter.lastReached, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
