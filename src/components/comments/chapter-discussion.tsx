import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CommentComposer } from "@/components/comments/comment-composer";
import { CommentItem } from "@/components/comments/comment-item";
import { useCommentMutations } from "@/components/comments/use-comment-mutations";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { ReportTargetDialog } from "@/components/reports/report-target-dialog";
import type { ReportSubmission } from "@/components/reports/report-target-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chapterCommentsQueryOptions } from "@/lib/comments/query";
import { COMMENT_VISIBLE_REPLIES } from "@/lib/comments/schemas";
import type { ChapterComment, CommentThread } from "@/lib/comments/types";

export interface ChapterDiscussionProps {
  novelId: string;
  chapterId: string;
  chapterNumber: string | number;
  /** Any session at all: guests read the discussion and are invited to sign in. */
  signedIn: boolean;
}

/** A comment whose words are no longer shown as written. */
function isGone(comment: ChapterComment): boolean {
  return comment.removedAt !== null || comment.deletedAt !== null;
}

/**
 * The chapter's discussion, at the end of the reader page.
 *
 * It sits *below* the previous/next navigation on purpose: the primary action at the end
 * of a chapter is the next chapter, and the discussion is where a reader lingers after
 * taking it. Newest comments come first and the composer stays at the top, so what a
 * reader just wrote is the first thing they see; replies hang one level under their
 * parent, oldest first, because a conversation reads forward.
 *
 * The section owns every mutation's mount point - composers, the delete confirmation, the
 * report dialog - while the mutation hooks own cache invalidation, so no child needs to
 * know how the list refreshes.
 */
export function ChapterDiscussion({
  novelId,
  chapterId,
  chapterNumber,
  signedIn,
}: ChapterDiscussionProps) {
  const query = useInfiniteQuery(chapterCommentsQueryOptions(chapterId));
  const { post, edit, remove, report } = useCommentMutations(chapterId);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    comment: ChapterComment;
    replyCount: number;
  } | null>(null);
  const [reporting, setReporting] = useState<ChapterComment | null>(null);

  const threads = query.data?.pages.flatMap((page) => page.threads) ?? [];
  const total = query.data?.pages[0]?.rowCount ?? 0;
  const chapterLabel = `Ch. ${Number(chapterNumber)}`;

  const submitComment = async (body: string, parentId?: string): Promise<boolean> => {
    try {
      await post.mutateAsync({ body, parentId });
      return true;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "That comment did not go through");
      return false;
    }
  };

  const submitEdit = async (commentId: string, body: string): Promise<boolean> => {
    try {
      await edit.mutateAsync({ commentId, body });
      setEditingId(null);
      return true;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "That comment could not be saved");
      return false;
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.comment.id);
      setDeleting(null);
    } catch {
      // The mutation hook already surfaced the failure; the dialog stays open so the
      // reader can try again rather than believing the comment is gone.
    }
  };

  const submitReport = async (submission: ReportSubmission) => {
    const target = reporting;
    if (!target) return;
    try {
      await report.mutateAsync({
        commentId: target.id,
        reason: submission.reason,
        details: submission.details,
      });
      setReporting(null);
    } catch {
      // The hook toasts; the dialog keeps the answers so nothing has to be retyped.
    }
  };

  return (
    <section
      aria-labelledby="chapter-discussion-heading"
      className="flex min-w-0 max-w-full flex-col gap-4 border-t border-border pt-6"
    >
      <header className="flex items-center gap-2">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2
          id="chapter-discussion-heading"
          className="text-body-lg font-semibold tracking-tight text-foreground"
        >
          Discussion
        </h2>
        {total > 0 ? (
          <Badge variant="muted" size="count" aria-hidden="true">
            {total}
          </Badge>
        ) : null}
      </header>

      {signedIn ? (
        <CommentComposer
          label={`Comment on ${chapterLabel}`}
          placeholder={`Share your thoughts on ${chapterLabel}…`}
          onSubmit={(body) => submitComment(body)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link
            to="/login"
            search={{ redirect: `/novels/${novelId}/chapters/${chapterId}` }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>{" "}
          to join the discussion. Reading stays open to everyone.
        </p>
      )}

      {query.isError ? (
        <QueryErrorState
          title="Failed to load the discussion"
          error={query.error}
          onRetry={() => void query.refetch()}
          className="my-0 min-h-0"
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex animate-pulse gap-3">
              <div className="size-7 shrink-0 rounded-full bg-muted" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : threads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          {signedIn
            ? `No comments yet. Be the first to share your thoughts on ${chapterLabel}.`
            : "No comments yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {threads.map((thread) => (
            <CommentThreadCard
              key={thread.id}
              thread={thread}
              signedIn={signedIn}
              replyingTo={replyingTo}
              editingId={editingId}
              onReplyOpen={setReplyingTo}
              onReplyClose={() => setReplyingTo(null)}
              onEditStart={setEditingId}
              onEditCancel={() => setEditingId(null)}
              onDelete={(comment, replyCount) => setDeleting({ comment, replyCount })}
              onReport={setReporting}
              onSubmitReply={submitComment}
              onSubmitEdit={submitEdit}
            />
          ))}
        </div>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more comments"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this comment?"
        description={
          deleting && deleting.replyCount > 0
            ? "Replies stay, and this comment will read as deleted."
            : "This removes the comment for everyone."
        }
        confirmText="Delete"
        variant="destructive"
        pending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      {reporting ? (
        <ReportTargetDialog
          open
          title="Report this comment?"
          description="An operator reviews every report. The report records which account filed it, the comment's author is not shown who reported it, and nothing is removed until an operator decides."
          preview={reporting.body}
          busy={report.isPending}
          onOpenChange={(open) => {
            if (!open) setReporting(null);
          }}
          onConfirm={(submission) => void submitReport(submission)}
        />
      ) : null}
    </section>
  );
}

interface CommentThreadCardProps {
  thread: CommentThread;
  signedIn: boolean;
  replyingTo: string | null;
  editingId: string | null;
  onReplyOpen: (commentId: string) => void;
  onReplyClose: () => void;
  onEditStart: (commentId: string) => void;
  onEditCancel: () => void;
  onDelete: (comment: ChapterComment, replyCount: number) => void;
  onReport: (comment: ChapterComment) => void;
  onSubmitReply: (body: string, parentId: string) => Promise<boolean>;
  onSubmitEdit: (commentId: string, body: string) => Promise<boolean>;
}

/**
 * One top-level comment with its replies. Replies carry no reply control of their own -
 * the discussion is one level deep by design - and the fetched window is bounded, so a
 * long thread says how much more exists instead of pretending it ended.
 */
function CommentThreadCard({
  thread,
  signedIn,
  replyingTo,
  editingId,
  onReplyOpen,
  onReplyClose,
  onEditStart,
  onEditCancel,
  onDelete,
  onReport,
  onSubmitReply,
  onSubmitEdit,
}: CommentThreadCardProps) {
  const [showAllReplies, setShowAllReplies] = useState(false);
  const replies = showAllReplies
    ? thread.replies
    : thread.replies.slice(0, COMMENT_VISIBLE_REPLIES);
  const hiddenCount = thread.replyCount - replies.length;
  const authorName = thread.author.name ?? "Reader";

  const renderItem = (
    comment: ChapterComment,
    options: { canReply: boolean; children?: ReactNode },
  ) => (
    <CommentItem
      key={comment.id}
      comment={comment}
      editor={
        editingId === comment.id ? (
          <CommentComposer
            label="Edit your comment"
            placeholder="Edit your comment…"
            submitLabel="Save changes"
            initialValue={comment.body ?? ""}
            autoFocus
            onSubmit={(body) => onSubmitEdit(comment.id, body)}
            onCancel={onEditCancel}
          />
        ) : undefined
      }
      onReply={
        options.canReply && signedIn && !isGone(comment) ? () => onReplyOpen(comment.id) : undefined
      }
      onEdit={comment.isOwn && !isGone(comment) ? () => onEditStart(comment.id) : undefined}
      onDelete={
        comment.isOwn && !isGone(comment)
          ? () => onDelete(comment, options.canReply ? thread.replyCount : 0)
          : undefined
      }
      onReport={
        signedIn && !comment.isOwn && !isGone(comment) ? () => onReport(comment) : undefined
      }
      footer={
        options.canReply && replyingTo === comment.id ? (
          <CommentComposer
            label={`Reply to ${authorName}`}
            placeholder={`Reply to ${authorName}…`}
            submitLabel="Post reply"
            autoFocus
            onSubmit={(body) => onSubmitReply(body, comment.id)}
            onCancel={onReplyClose}
          />
        ) : undefined
      }
    >
      {options.children}
    </CommentItem>
  );

  return renderItem(thread, {
    canReply: true,
    children: (
      <>
        {replies.map((reply) => renderItem(reply, { canReply: false }))}
        {hiddenCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setShowAllReplies(true)}
          >
            Show all {thread.replyCount} replies
          </Button>
        ) : null}
        {showAllReplies && thread.repliesTruncated ? (
          <p className="text-caption text-muted-foreground">
            Showing the earliest {thread.replies.length} of {thread.replyCount} replies.
          </p>
        ) : null}
      </>
    ),
  });
}
