import { useQuery } from "@tanstack/react-query";

import { StarRating } from "@/components/reviews/star-rating";
import { novelRatingQueryOptions } from "@/lib/reviews/query";

export interface NovelRatingSummaryProps {
  novelId: string;
  className?: string;
}

/**
 * The score beside the novel title.
 *
 * Nothing renders until there is at least one rating, so a fresh novel is never labelled
 * "0.0" - an unrated novel simply has no score. The link jumps to the full reviews
 * section further down the page, which is where the rating widget lives.
 */
export function NovelRatingSummary({ novelId, className }: NovelRatingSummaryProps) {
  const rating = useQuery(novelRatingQueryOptions(novelId));
  const summary = rating.data;
  if (!summary || summary.count === 0 || summary.average === null) return null;

  return (
    <div className={className}>
      <a
        href="#reviews"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground no-underline hover:text-foreground"
      >
        <StarRating value={summary.average} />
        <span className="font-medium text-foreground">{summary.average.toFixed(1)}</span>
        <span>
          · {summary.count} {summary.count === 1 ? "rating" : "ratings"}
        </span>
        <span className="underline underline-offset-4">Read reviews</span>
      </a>
    </div>
  );
}
