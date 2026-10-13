import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Twenty variants collapsed onto three treatments. Every old name still resolves — to a
 * literal class string, because Tailwind can only see literals — so no call site moves.
 *   neutral — hairline border, foreground text (the default "this is a label" chip)
 *   quiet   — recessed fill, muted text (statuses that are informational only)
 *   tone    — a muted tone tint; outline variants keep the tone and drop the fill
 * Badges are square-ish now: pill radius is reserved for icon toggles, and only the
 * counting badge (which lives inside a control) keeps a full radius.
 */
const NEUTRAL = "border-border-strong text-foreground [a]:hover:bg-surface-inset";
const QUIET = "border-border bg-surface-inset text-muted-foreground [a]:hover:text-foreground";
const INFO = "border-info/30 bg-info/10 text-info";
const WARNING = "border-warning/30 bg-warning/10 text-warning";
const SUCCESS = "border-success/30 bg-success/10 text-success";
const DESTRUCTIVE = "border-destructive/30 bg-destructive/10 text-destructive-text";
const WARNING_OUTLINE = "border-warning/40 text-warning";
const SUCCESS_OUTLINE = "border-success/40 text-success";
const DESTRUCTIVE_OUTLINE = "border-destructive/40 text-destructive-text";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 py-0.5 text-xs font-normal whitespace-nowrap transition-colors duration-micro focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary: "border-transparent bg-surface-inset text-foreground",
        outline: NEUTRAL,
        strongOutline: NEUTRAL,
        muted: QUIET,
        mutedOutline: QUIET,
        ghost: QUIET,
        info: INFO,
        warning: WARNING,
        warningStrong: WARNING,
        warningSubtle: WARNING,
        warningOutline: WARNING_OUTLINE,
        success: SUCCESS,
        successSubtle: SUCCESS,
        successOutline: SUCCESS_OUTLINE,
        destructive: DESTRUCTIVE,
        destructiveOutline: DESTRUCTIVE_OUTLINE,
        link: "border-transparent text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "",
        stat: "px-3 py-1 font-mono",
        count: "rounded-full px-1.5 py-0 text-badge-count font-mono",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant = "outline",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

// badgeVariants intentionally not exported: nothing outside this file uses
// it, and non-component exports break Fast Refresh state preservation.
export { Badge };
