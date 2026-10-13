import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { ReportTargetDialog } from "@/components/reports/report-target-dialog";
import type { ReportSubmission } from "@/components/reports/report-target-dialog";
import { ReviewForm } from "@/components/reviews/review-form";
import { ReviewItem } from "@/components/reviews/review-item";
import { StarRating } from "@/components/reviews/star-rating";
import { useReviewMutations } from "@/components/reviews/use-review-mutations";
import { Button } from "@/components/ui/button";
import {
  myReviewQueryOptions,
  novelRatingQueryOptions,
  novelReviewsQueryOptions,
} from "@/lib/reviews/query";
import type { NovelReview } from "@/lib/reviews/types";

export interface NovelReviewsSectionProps {
  novelId: string;
  signedIn: boolean;
  /** The novel's owner, who rates other people's novels rather than their own. */
  canManage: boolean;
  /** Reviews exist only for a live novel; a draft shows nothing. */
  isLive: boolean;
}

/**
 * The novel's reviews: the score, the distribution behind it, the reader's own review, and
 * everybody else's.
 *
 * The viewer's own review is pinned above the list and excluded from it, so editing is one
 * tap away instead of one page. A removed review is shown only to its author - the server
 * never sends anyone else's - which is why the tombstone state lives in this component at
 * all.
 */
export function NovelReviewsSection({
  novelId,
  signedIn,
  canManage,
  isLive,
}: NovelReviewsSectionProps) {
  const rating = useQuery(novelRatingQueryOptions(novelId));
  const reviews = useInfiniteQuery({
    ...novelReviewsQueryOptions(novelId),
    enabled: isLive,
  });
  const myReviewQuery = useQuery({ ...myReviewQueryOptions(novelId), enabled: signedIn });
  const { save, remove, report } = useReviewMutations(novelId);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<NovelReview | null>(null);
  const [reporting, setReporting] = useState<NovelReview | null>(null);

  const myReview = myReviewQuery.data?.review ?? null;
  const summary = rating.data;
  const list = reviews.data?.pages.flatMap((page) => page.reviews) ?? [];
  const others = list.filter((review) => !review.isOwn);

  const submitReport = async (submission: ReportSubmission) => {
    const target = reporting;
    if (!target) return;
    try {
      await report.mutateAsync({
        reviewId: target.id,
        reason: submission.reason,
        details: submission.details,
      });
      setReporting(null);
    } catch {
      // The hook toasts; the dialog keeps the answers so nothing has to be retyped.
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync();
      setDeleting(null);
    } catch {
      // Handled by the hook; the dialog stays open.
    }
  };

  // A novel with no score and nothing to add is not a section worth rendering.
  const showComposer = isLive && signedIn && !canManage && (!myReview || editing);
  const showSection = isLive || (summary?.count ?? 0) > 0 || myReview !== null;
  if (!showSection) return null;

  return (
    <section
      id="reviews"
      aria-labelledby="novel-reviews-heading"
      className="flex scroll-mt-24 flex-col gap-6"
    >
      <div className="flex flex-col gap-4">
        <h2
          id="novel-reviews-heading"
          className="text-body-lg font-semibold tracking-tight text-foreground"
        >
          Reviews
        </h2>

        {summary && summary.count > 0 && summary.average !== null ? (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="flex items-center gap-3">
              <span className="text-section font-semibold text-foreground">
                {summary.average.toFixed(1)}
              </span>
              <div className="flex flex-col gap-1">
                <StarRating value={summary.average} iconClassName="size-4" />
                <span className="text-caption text-muted-foreground">
                  {summary.count} {summary.count === 1 ? "rating" : "ratings"}
                </span>
              </div>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
              {summary.distribution.map((bucket) => {
                const percent = summary.count > 0 ? (bucket.count / summary.count) * 100 : 0;
                return (
                  <li key={bucket.rating} className="flex items-center gap-2 text-caption">
                    <span className="flex w-8 shrink-0 items-center gap-0.5 tabular-nums text-muted-foreground">
                      {bucket.rating}
                      <Star className="size-3 fill-current" aria-hidden="true" />
                    </span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-foreground/60"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                      {bucket.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <p className="text-sm text-muted-foreground">
          Ratings come from readers. You cannot review your own novel.
        </p>
      ) : !signedIn ? (
        isLive ? (
          <p className="text-sm text-muted-foreground">
            <Link
              to="/login"
              search={{ redirect: `/novels/${novelId}` }}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Sign in
            </Link>{" "}
            to rate this novel and share what you thought.
          </p>
        ) : null
      ) : myReview && !editing ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <span className="text-caption tracking-wide text-muted-foreground uppercase">
            Your review
          </span>
          <ReviewItem
            review={myReview}
            onEdit={myReview.removedAt === null ? () => setEditing(true) : undefined}
            onDelete={myReview.removedAt === null ? () => setDeleting(myReview) : undefined}
          />
          {myReview.removedAt !== null ? (
            <p className="text-caption text-muted-foreground">
              You can post a new review whenever you like.
            </p>
          ) : null}
        </div>
      ) : null}

      {showComposer ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <ReviewForm
            initialRating={editing ? (myReview?.rating ?? 0) : 0}
            initialBody={editing ? (myReview?.body ?? "") : ""}
            submitLabel={editing ? "Save review" : "Post review"}
            pending={save.isPending}
            onCancel={editing ? () => setEditing(false) : undefined}
            onSubmit={async ({ rating: value, body }) => {
              await save.mutateAsync({ rating: value, body });
              setEditing(false);
            }}
          />
        </div>
      ) : null}

      {reviews.isError ? (
        <QueryErrorState
          title="Failed to load reviews"
          error={reviews.error}
          onRetry={() => void reviews.refetch()}
          className="my-0 min-h-0"
        />
      ) : reviews.isPending && isLive ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          {[0, 1].map((row) => (
            <div key={row} className="flex animate-pulse gap-3">
              <div className="size-7 shrink-0 rounded-full bg-muted" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-3 w-40 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : others.length === 0 ? (
        myReview === null ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
            No reviews yet.
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-6">
          {others.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              onReport={signedIn && !review.isOwn ? () => setReporting(review) : undefined}
            />
          ))}
        </div>
      )}

      {reviews.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={reviews.isFetchingNextPage}
            onClick={() => void reviews.fetchNextPage()}
          >
            {reviews.isFetchingNextPage ? "Loading…" : "Load more reviews"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete your review?"
        description="The rating leaves the novel's average. You can review it again later."
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
          title="Report this review?"
          description="An operator reviews every report. The report records which account filed it, the author is not shown who reported it, and nothing is removed until an operator decides."
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
