import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";

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
import { describeReportReason } from "@/lib/reports/reasons";
import type { ReportCase } from "@/lib/reports/types";

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
 * One case in the open queue.
 *
 * The cover is only offered a novel id when the server resolved a public URL for it:
 * a draft's cover is not served to anyone but its owner, so pointing the image at the
 * proxy route would render a broken cover where the placeholder belongs.
 */
export function ReportCaseTableRow({ row, onReview }: { row: ReportCase; onReview: () => void }) {
  const state = publishState(row.target.publishedAt);

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            <NovelCover
              novelId={row.target.coverUrl ? row.target.novelId : null}
              coverUrl={row.target.coverUrl}
              coverSrcSet={row.target.coverSrcSet}
              alt={row.target.title}
              sizes="44px"
              fallbackSize={8}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
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
            <span className="truncate text-caption text-muted-foreground">
              {row.target.ownerEmail ?? "Owner account removed"}
            </span>
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
