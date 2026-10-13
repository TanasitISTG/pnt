import type { ReactNode } from "react";
import { Flag, MoreHorizontal, Pencil, Reply, Trash2 } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChapterComment } from "@/lib/comments/types";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relative-time";

export interface CommentItemProps {
  comment: ChapterComment;
  /** Omitted for guests and for comments nobody may act on. */
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  /** Rendered in place of the body while the comment is being edited. */
  editor?: ReactNode;
  /** The reply composer, under this comment. */
  footer?: ReactNode;
  /** Replies, indented under their parent. */
  children?: ReactNode;
}

/**
 * One comment, in every state it can be read in.
 *
 * A removed or deleted comment renders as a tombstone instead of its words, and loses
 * every action - replying to something that is gone, or editing one's own removed words,
 * would both be dead ends. The overflow menu only appears when it holds at least one real
 * action, so a guest (who can do nothing) never meets an empty control.
 */
export function CommentItem({
  comment,
  onReply,
  onEdit,
  onDelete,
  onReport,
  editor,
  footer,
  children,
}: CommentItemProps) {
  const gone = comment.removedAt !== null || comment.deletedAt !== null;
  const hasActions = !gone && Boolean(onReply || onEdit || onDelete || onReport);
  const reportDisabled = comment.viewerReported;

  return (
    <article className="flex gap-3">
      <UserAvatar
        name={comment.author.name ?? "Reader"}
        avatar={comment.author.avatar}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-foreground">
            {comment.author.name ?? (comment.author.id ? "Reader" : "Deleted account")}
          </span>
          <time
            className="shrink-0 text-caption text-muted-foreground"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={formatAbsoluteTime(comment.createdAt)}
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && !gone ? (
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
                    aria-label="Comment actions"
                  />
                }
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onReply ? (
                  <DropdownMenuItem onClick={onReply}>
                    <Reply className="size-4" />
                    Reply
                  </DropdownMenuItem>
                ) : null}
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
                {onReport && (onReply || onEdit || onDelete) ? <DropdownMenuSeparator /> : null}
                {onReport ? (
                  <DropdownMenuItem disabled={reportDisabled} onClick={onReport}>
                    <Flag className="size-4" />
                    {reportDisabled ? "Reported" : "Report"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </header>

        {comment.removedAt !== null ? (
          <p className="mt-1 text-sm text-muted-foreground italic">
            Removed by an operator
            {comment.removalReason ? `: ${comment.removalReason}` : "."}
          </p>
        ) : comment.deletedAt !== null ? (
          <p className="mt-1 text-sm text-muted-foreground italic">
            Comment deleted by its author.
          </p>
        ) : editor ? (
          <div className="mt-2">{editor}</div>
        ) : (
          <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
            {comment.body}
          </p>
        )}

        {footer ? <div className="mt-2">{footer}</div> : null}
        {children ? (
          <div className="mt-3 flex flex-col gap-4 border-l border-border pl-3">{children}</div>
        ) : null}
      </div>
    </article>
  );
}
