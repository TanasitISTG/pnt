import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { NovelAudienceRow } from "@/lib/analytics/types";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

/**
 * One row per owned novel, most-read first, each one a door into that novel's own report.
 *
 * Every figure is the per-novel report's figure, which is what makes the rollup trustworthy:
 * a row can be checked against the tab it links to. A novel nobody has read stays in the
 * list with its zeros, because "followed but unread" is exactly what a writer wants to see,
 * and a table that hid it would look like the novel had been forgotten instead.
 */
export function AccountNovelTable({ novels }: { novels: NovelAudienceRow[] }) {
  const t = useTranslations("analytics");
  const locale = useLocale() as Locale;
  // Read once per mount: a scheduled chapter must not flip to published mid-interaction.
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
            <TableHead>{t("columnNovel")}</TableHead>
            <TableHead className="text-right">{t("columnReaders")}</TableHead>
            <TableHead className="text-right">{t("columnReads")}</TableHead>
            <TableHead className="text-right">{t("columnFollowers")}</TableHead>
            <TableHead className="text-right">{t("columnWaiting")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {novels.map((novel) => (
            <TableRow key={novel.id}>
              <TableCell className="max-w-[22rem]">
                <Link
                  to="/novels/$novelId/manage/analytics"
                  params={{ novelId: novel.id }}
                  className="block truncate text-foreground no-underline hover:underline underline-offset-4"
                >
                  {novel.title}
                </Link>
                <span className="block text-caption text-muted-foreground">
                  {novel.publishedAt
                    ? `${stateOf(novel.publishedAt)} · ${formatDate(novel.publishedAt, locale)}`
                    : stateOf(null)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(novel.readers, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(novel.reads, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(novel.followers, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(novel.waitingFollowers, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
