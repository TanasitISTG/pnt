import * as React from "react";

import { focusRing } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  /** Visible label. Hidden below `sm` when the option also carries an icon. */
  label: string;
  icon?: React.ReactNode;
  /** Accessible name when the visible label is hidden. Defaults to `label`. */
  srLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onValueChange: (value: T) => void;
  /** Names the group for assistive technology; never rendered. */
  label: string;
  /**
   * `compact` is the same height as `default` and narrower, for a control that shares its
   * line with the label naming it. The reader's seven settings rows put the widest of them
   * — "Compact · Normal · Relaxed" — onto a second line at 320px, and the padding is what
   * buys the words back onto the label's line without dropping a step of the type scale.
   */
  size?: "sm" | "compact" | "default";
  className?: string;
}

/**
 * Small set of mutually exclusive choices (grid/list, view mode, a filter). A pressed
 * button group rather than tabs: nothing here owns a panel, and `aria-pressed` is what
 * a screen reader should hear. Deliberately not a pill — the selected item is a surface
 * inside a recessed track.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  label,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-inset p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-micro",
              size === "sm" && "h-7 px-2 text-micro",
              size === "compact" && "h-9 px-1.5 text-caption",
              size === "default" && "h-9 px-3 text-caption",
              selected
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
              focusRing,
            )}
          >
            {option.icon ? <span className="[&_svg]:size-4">{option.icon}</span> : null}
            <span className={cn(option.icon && "hidden sm:inline")}>{option.label}</span>
            {option.srLabel ? <span className="sr-only">{option.srLabel}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
