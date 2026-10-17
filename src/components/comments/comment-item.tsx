import type { ReactNode } from "react";
import { Flag, MoreHorizontal, Pencil, Reply, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { DiscussionTombstone } from "@/components/discussion/discussion-parts";
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
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/i18n/format";

export interface CommentItemProps {
  comment: ChapterComment;
  /** Omitted for guests and for comments nobody may act on. */
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  /** Rendered in place of the body while the comment is being edited. */
  editor?: ReactNode;
  /** The reply composer, after the reply list, so a new reply lands above it. */
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
  const t = useTranslations("comments");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const gone = comment.removedAt !== null || comment.deletedAt !== null;
  const hasActions = !gone && Boolean(onReply || onEdit || onDelete || onReport);
  const reportDisabled = comment.viewerReported;

  return (
    <article className="flex gap-3">
      <UserAvatar
        name={comment.author.name ?? tCommon("reader")}
        avatar={comment.author.avatar}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-body font-medium text-foreground">
            {comment.author.name ??
              (comment.author.id ? tCommon("reader") : tCommon("deletedAccount"))}
          </span>
          <time
            className="shrink-0 text-caption text-muted-foreground"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={formatAbsoluteTime(comment.createdAt, locale)}
          >
            {formatRelativeTime(comment.createdAt, locale)}
          </time>
          {comment.editedAt && !gone ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              · {tCommon("edited")}
            </span>
          ) : null}
          {hasActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto shrink-0"
                    aria-label={t("actionsLabel")}
                  />
                }
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onReply ? (
                  <DropdownMenuItem onClick={onReply}>
                    <Reply className="size-4" />
                    {t("reply")}
                  </DropdownMenuItem>
                ) : null}
                {onEdit ? (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4" />
                    {tCommon("edit")}
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2 className="size-4" />
                    {tCommon("delete")}
                  </DropdownMenuItem>
                ) : null}
                {onReport && (onReply || onEdit || onDelete) ? <DropdownMenuSeparator /> : null}
                {onReport ? (
                  <DropdownMenuItem disabled={reportDisabled} onClick={onReport}>
                    <Flag className="size-4" />
                    {reportDisabled ? tCommon("reported") : tCommon("report")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </header>

        {comment.removedAt !== null ? (
          <DiscussionTombstone kind="removed" reason={comment.removalReason} />
        ) : comment.deletedAt !== null ? (
          <DiscussionTombstone kind="deleted" />
        ) : editor ? (
          <div className="mt-2">{editor}</div>
        ) : (
          <p className="mt-1 text-body leading-relaxed break-words whitespace-pre-wrap text-foreground">
            {comment.body}
          </p>
        )}

        {children ? (
          <div className="mt-3 flex flex-col gap-4 border-l border-border pl-3">{children}</div>
        ) : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </article>
  );
}
