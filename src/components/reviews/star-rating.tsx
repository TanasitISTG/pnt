import { Star } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

export interface StarRatingProps {
  /** Any value 0-5; a fractional average clips the filled run instead of rounding it. */
  value: number;
  className?: string;
  iconClassName?: string;
}

/**
 * A read-only score. The filled run is clipped at its exact fraction, so 4.6 stars reads
 * as more than 4 - rounding an average to whole stars would overstate it.
 */
export function StarRating({ value, className, iconClassName }: StarRatingProps) {
  const t = useTranslations("reviews");
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      role="img"
      aria-label={t("starsLabel", { value })}
    >
      <span className="flex gap-0.5 text-foreground/20" aria-hidden="true">
        {STARS.map((star) => (
          <Star key={star} className={cn("size-4", iconClassName)} />
        ))}
      </span>
      <span
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${percent}%` }}
        aria-hidden="true"
      >
        <span className="flex gap-0.5 text-foreground">
          {STARS.map((star) => (
            <Star key={star} className={cn("size-4 fill-current", iconClassName)} />
          ))}
        </span>
      </span>
    </span>
  );
}

export interface StarRatingInputProps {
  /** 0 means nothing chosen yet; the submit control stays disabled until a star is picked. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Names the group for assistive technology, e.g. "Your rating". */
  label?: string;
}

/**
 * The rating control. Hover and focus preview the score before it is committed, but a
 * click only sets the draft - the review is posted by an explicit submit, so a mis-tap
 * never publishes a rating.
 *
 * Each star is a real button with its own name ("Rate 4 out of 5") and at least a 44px
 * target, which keeps both touch and keyboard use to one clear gesture.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled = false,
  label,
}: StarRatingInputProps) {
  const t = useTranslations("reviews");
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;

  return (
    <div
      role="group"
      aria-label={label ?? t("yourRating")}
      className="flex items-center gap-1"
      onMouseLeave={() => setPreview(null)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          aria-label={t("rateStar", { star })}
          aria-pressed={value === star}
          className="rounded-md p-2 text-foreground transition-transform outline-none select-none active:scale-95 focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          onClick={() => onChange(star)}
          onMouseEnter={() => setPreview(star)}
          onFocus={() => setPreview(star)}
          onBlur={() => setPreview(null)}
        >
          <Star
            className={cn("size-6", star <= shown ? "fill-current" : "text-foreground/25")}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
