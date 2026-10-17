import { Link } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal, Star } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { reportReasonLabel, reportTargetLabel } from "@/components/admin/reports/report-labels";
import { NovelCover } from "@/components/novels/novel-cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { publishState } from "@/lib/content/publish/publish";
import { formatDate } from "@/lib/i18n/format";
import type { ReportCase, ReportCaseTarget } from "@/lib/reports/types";

const STATE_VARIANTS = {
  draft: "muted",
  scheduled: "warning",
  live: "success",
} as const;

/**
 * Who a comment or review case is about, in one line: the account, plus the chapter a
 * comment lives in or the rating a review carried.
 *
 * A part of the sentence rather than a string it assembles, because the words around the
 * account are the catalog's: the chapter label and the rating ride inside the message as
 * values, and Thai words the line its own way.
 */
function TargetContext({ target }: { target: ReportCaseTarget }) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");

  if (target.type === "novel") {
    return <>{target.ownerEmail ?? t("casesOwnerRemoved")}</>;
  }

  const who = target.authorEmail ?? target.authorName ?? t("casesAccountRemoved");
  if (target.type === "comment") {
    return (
      <>
        {target.chapterNumber === null
          ? t("casesCommentBy", { who })
          : t("casesCommentByChapter", {
              who,
              chapter: tCommon("chapterShort", { number: target.chapterNumber }),
            })}
      </>
    );
  }
  // A rating is a number and its scale, which is punctuation rather than a word: 4/5 reads
  // the same in both languages, so the message around it carries the only words.
  const rating = target.rating === null ? null : `${target.rating}/5`;
  return (
    <>{rating === null ? t("casesReviewBy", { who }) : t("casesReviewByRating", { who, rating })}</>
  );
}

/**
 * One case in the open queue.
 *
 * A novel shows its cover; a comment or review shows a glyph, because there is no cover
 * for words. The reported excerpt is carried into the row so an operator can triage
 * without opening every case, and the cover is only offered a novel id when the server
 * resolved a public URL for it: a draft's cover is not served to anyone but its owner, so
 * pointing the image at the proxy route would render a broken cover where the placeholder
 * belongs.
 */
export function ReportCaseTableRow({ row, onReview }: { row: ReportCase; onReview: () => void }) {
  const t = useTranslations("admin");
  const tReports = useTranslations("reports");
  const tCatalog = useTranslations("catalog");
  const locale = useLocale();
  const state = publishState(row.target.publishedAt);
  const isNovel = row.target.type === "novel";
  // The three publication states are the shelf's own words, not the console's: an operator
  // reads the same Draft / Scheduled / Live a reader sees on the catalogue.
  const stateLabels = {
    draft: tCatalog("stateDraft"),
    scheduled: tCatalog("stateScheduled"),
    live: tCatalog("stateLive"),
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {isNovel ? (
              <NovelCover
                novelId={row.target.coverUrl ? row.target.novelId : null}
                coverUrl={row.target.coverUrl}
                coverSrcSet={row.target.coverSrcSet}
                alt={row.target.title}
                sizes="44px"
                fallbackSize={8}
                className="h-full w-full object-cover"
              />
            ) : row.target.type === "comment" ? (
              <MessageSquare className="size-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Star className="size-5 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="outline">{reportTargetLabel(tReports, row.target.type)}</Badge>
              {row.target.novelId ? (
                <Link
                  to="/{-$locale}/novels/$novelId"
                  params={{ novelId: row.target.novelId }}
                  className="truncate font-medium text-foreground underline-offset-3 hover:underline"
                >
                  {row.target.title}
                </Link>
              ) : (
                <span className="truncate font-medium text-foreground">{row.target.title}</span>
              )}
            </div>
            <span className="truncate text-caption text-muted-foreground">
              <TargetContext target={row.target} />
              {row.target.deleted ? <> · {t("casesTargetDeleted")}</> : null}
            </span>
            {row.target.excerpt ? (
              <span className="line-clamp-1 max-w-72 text-caption text-muted-foreground">
                {row.target.excerpt}
              </span>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">{t("casesOpenCount", { count: row.openCount })}</Badge>
          <span className="max-w-56 text-caption text-muted-foreground">
            {row.reasons.map((reason) => reportReasonLabel(tReports, reason)).join(" · ")}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant={STATE_VARIANTS[state]}>{stateLabels[state]}</Badge>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <div className="flex flex-col">
          <span>{formatDate(row.firstReportedAt, locale)}</span>
          <span className="text-caption">
            {t("casesLatest", { date: formatDate(row.lastReportedAt, locale) })}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="size-9" />}
            aria-label={t("casesActionsFor", { title: row.target.title })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onReview}>{t("casesReviewAction")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
