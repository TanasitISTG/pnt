import { useState } from "react";
import { Flag, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { DiscussionTombstone } from "@/components/discussion/discussion-parts";
import { StarRating } from "@/components/reviews/star-rating";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relative-time";
import type { NovelReview } from "@/lib/reviews/types";

/** Long bodies collapse behind "Show more" so one review cannot own the whole page. */
const BODY_COLLAPSE_THRESHOLD = 480;

export interface ReviewItemProps {
  review: NovelReview;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}

/**
 * One review: stars always, words only when there are any.
 *
 * A removed review renders as a tombstone with its reason - visible only to its author,
 * which is who this state exists for - and a rating-only review stays compact instead of
 * leaving an empty paragraph behind.
 */
export function ReviewItem({ review, onEdit, onDelete, onReport }: ReviewItemProps) {
  const [expanded, setExpanded] = useState(false);
  const removed = review.removedAt !== null;
  const longBody = (review.body?.length ?? 0) > BODY_COLLAPSE_THRESHOLD;
  const showBody = review.body !== null && !removed;
  const hasActions = !removed && Boolean(onEdit || onDelete || onReport);

  return (
    <article className="flex gap-3">
      <UserAvatar
        name={review.author.name ?? "Reader"}
        avatar={review.author.avatar}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-body font-medium text-foreground">
            {review.author.name ?? (review.author.id ? "Reader" : "Deleted account")}
          </span>
          {!removed ? (
            <StarRating value={review.rating} iconClassName="size-3.5" className="shrink-0" />
          ) : null}
          <time
            className="shrink-0 text-caption text-muted-foreground"
            dateTime={new Date(review.createdAt).toISOString()}
            title={formatAbsoluteTime(review.createdAt)}
          >
            {formatRelativeTime(review.createdAt)}
          </time>
          {review.editedAt && !removed ? (
            <span className="shrink-0 text-caption text-muted-foreground">· edited</span>
          ) : null}
          {hasActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto shrink-0"
                    aria-label="Review actions"
                  />
                }
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {onEdit ? (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                ) : null}
                {onReport ? (
                  <DropdownMenuItem disabled={review.viewerReported} onClick={onReport}>
                    <Flag className="size-4" />
                    {review.viewerReported ? "Reported" : "Report"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </header>

        {removed ? (
          <DiscussionTombstone kind="removed" reason={review.removalReason} />
        ) : showBody ? (
          <>
            <p
              className={
                longBody && !expanded
                  ? "mt-1 line-clamp-6 text-body leading-relaxed break-words whitespace-pre-wrap text-foreground"
                  : "mt-1 text-body leading-relaxed break-words whitespace-pre-wrap text-foreground"
              }
            >
              {review.body}
            </p>
            {longBody ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 mt-1"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show less" : "Show more"}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}
