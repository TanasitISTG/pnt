import { cn } from "@/lib/utils";

interface LangPairProps {
  source: string;
  target: string;
  /** `inline` for cards and metadata; `chip` for headers and filters. */
  variant?: "inline" | "chip";
  size?: "sm" | "md";
  className?: string;
}

/**
 * The product's subject, as type: a language pair set as one unit, with the source quiet
 * and the target carrying the weight — a translation is the thing being made. Screen
 * readers hear one phrase instead of two stray codes and an arrow.
 */
export function LangPair({
  source,
  target,
  variant = "inline",
  size = "sm",
  className,
}: LangPairProps) {
  const from = source.toUpperCase();
  const to = target.toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        variant === "chip" && "rounded-sm border border-border-strong px-1.5 py-0.5",
        className,
      )}
    >
      <span className="sr-only">{`${from} to ${to}`}</span>
      <span
        aria-hidden="true"
        className={cn(
          "font-medium tracking-[0.08em] text-fg-3",
          size === "sm" ? "text-micro" : "text-caption",
        )}
      >
        {from}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "leading-none text-border-strong",
          size === "sm" ? "text-micro" : "text-caption",
        )}
      >
        →
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "font-semibold tracking-[0.08em] text-foreground",
          size === "sm" ? "text-micro" : "text-caption",
        )}
      >
        {to}
      </span>
    </span>
  );
}
