import { Link } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal, Star } from "lucide-react";

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
import { describeReportReason, describeReportTarget } from "@/lib/reports/reasons";
import type { ReportCase, ReportCaseTarget } from "@/lib/reports/types";

const STATE_LABELS = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
} as const;

const STATE_VARIANTS = {
  draft: "muted",
  scheduled: "warning",
  live: "success",
} as const;

/**
 * Who a comment or review case is about, in one line: the account, plus the chapter a
 * comment lives in or the rating a review carried.
 */
function targetContext(target: ReportCaseTarget): string {
  if (target.type === "novel") {
    return target.ownerEmail ?? "Owner account removed";
  }

  const who = target.authorEmail ?? target.authorName ?? "an account that has been removed";
  if (target.type === "comment") {
    const chapter = target.chapterNumber === null ? null : `Ch. ${target.chapterNumber}`;
    return `Comment by ${who}${chapter ? ` · ${chapter}` : ""}`;
  }
  const rating = target.rating === null ? null : `${target.rating}/5`;
  return `Review by ${who}${rating ? ` · ${rating}` : ""}`;
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
  const state = publishState(row.target.publishedAt);
  const isNovel = row.target.type === "novel";

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
              <Badge variant="outline">{describeReportTarget(row.target.type)}</Badge>
              {row.target.novelId ? (
                <Link
                  to="/novels/$novelId"
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
              {targetContext(row.target)}
              {row.target.deleted ? " · no longer exists" : ""}
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
          <Badge variant="secondary">{row.openCount} open</Badge>
          <span className="max-w-56 text-caption text-muted-foreground">
            {row.reasons.map((reason) => describeReportReason(reason)).join(" · ")}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant={STATE_VARIANTS[state]}>{STATE_LABELS[state]}</Badge>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <div className="flex flex-col">
          <span>{new Date(row.firstReportedAt).toLocaleDateString()}</span>
          <span className="text-caption">
            Latest {new Date(row.lastReportedAt).toLocaleDateString()}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="size-9" />}
            aria-label={`Actions for ${row.target.title}`}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onReview}>Review case</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
