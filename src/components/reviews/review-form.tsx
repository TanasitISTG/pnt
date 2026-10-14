import { useState } from "react";
import { useTranslations } from "use-intl";

import { StarRatingInput } from "@/components/reviews/star-rating";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_BODY_MAX_LENGTH } from "@/lib/reviews/schemas";

export interface ReviewFormProps {
  /** An edit starts from what was written; a new review starts blank. */
  initialRating?: number;
  initialBody?: string;
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (input: { rating: number; body?: string }) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Rating plus optional words.
 *
 * The star row only sets a draft and the explicit submit publishes it: rating is the one
 * required field, writing is not, and neither should happen by mis-tap. The words are
 * optional on purpose - a one-tap score is a full review.
 */
export function ReviewForm({
  initialRating = 0,
  initialBody = "",
  submitLabel,
  pending = false,
  onSubmit,
  onCancel,
}: ReviewFormProps) {
  const t = useTranslations("reviews");
  const tCommon = useTranslations("common");
  const [rating, setRating] = useState(initialRating);
  const [body, setBody] = useState(initialBody);

  const trimmed = body.trim();
  const canSubmit = rating > 0 && !pending;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        void onSubmit({ rating, body: trimmed.length > 0 ? trimmed : undefined });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StarRatingInput value={rating} onChange={setRating} disabled={pending} />
        <span className="text-caption text-muted-foreground" aria-live="polite">
          {rating > 0 ? t("ofFive", { value: rating }) : t("pickRating")}
        </span>
      </div>

      <label className="sr-only" htmlFor="review-body">
        {t("bodyLabel")}
      </label>
      <Textarea
        id="review-body"
        value={body}
        rows={4}
        maxLength={REVIEW_BODY_MAX_LENGTH}
        disabled={pending}
        placeholder={t("bodyPlaceholder")}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-caption text-muted-foreground">
          {body.length}/{REVIEW_BODY_MAX_LENGTH}
        </span>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {pending ? <Spinner /> : null}
            {submitLabel ?? t("postReview")}
          </Button>
        </div>
      </div>
    </form>
  );
}
