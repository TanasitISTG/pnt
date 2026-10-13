import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { focusRing } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

/*
 * Variant names are unchanged so no call site has to move, but the recipes behind them
 * are now three: a filled primary (with the inset signature), a hairline outline, and a
 * borderless ghost. Status variants only re-tone the text and the hover tint — the
 * geometry, border and radius stay identical, which is what made the old set read as
 * thirteen different components.
 */
const buttonVariants = cva(
  cn(
    "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-body whitespace-nowrap select-none transition-[color,background-color,border-color,scale,opacity] duration-press ease-out-quint active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ),
  {
    variants: {
      variant: {
        // Filled primary — charcoal in light, cream in dark, inset shadow signature
        default: "bg-primary text-primary-foreground shadow-button-inset hover:bg-primary/90",
        // Hairline outline — the interactive border tier, one recipe
        outline: "border-border-strong bg-transparent text-foreground hover:bg-surface-inset",
        outlineWarning: "border-warning/40 bg-transparent text-warning hover:bg-warning/10",
        outlineDestructive:
          "border-destructive/40 bg-transparent text-destructive-text hover:bg-destructive/8",
        outlineDestructiveStrong:
          "border-destructive/40 bg-transparent text-destructive-text hover:bg-destructive/10",
        // Borderless — a quiet tint on hover, no geometry of its own
        ghost: "text-foreground hover:bg-surface-inset",
        ghostWarning: "text-warning hover:bg-warning/10",
        ghostDestructive: "text-destructive-text hover:bg-destructive/8",
        ghostPrimary: "text-ink hover:bg-ink-quiet",
        ghostMuted: "text-muted-foreground hover:bg-surface-inset hover:text-foreground",
        // Tertiary action on its own surface
        cream: "bg-surface text-foreground hover:bg-surface-2",
        // The only pill in the system, for icon toggles
        pill: "rounded-full bg-surface text-foreground shadow-button-inset hover:bg-surface-2",
        destructive:
          "bg-destructive text-destructive-foreground shadow-button-inset hover:bg-destructive/90",
        link: "text-foreground underline underline-offset-4 hover:text-ink",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-caption",
        lg: "h-11 px-5 text-body-lg",
        icon: "size-11 rounded-full",
        // 36px: the documented dense exception for console rows and overlay corners.
        "icon-sm": "size-9 rounded-full",
        chapterOption: "h-auto min-h-11 px-4 py-2",
        readerNav: "h-auto min-h-11 gap-1.5 px-2.5 py-1 sm:gap-2 sm:px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      nativeButton={props.render ? false : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

// buttonVariants intentionally not exported: nothing outside this file uses
// it, and non-component exports break Fast Refresh state preservation.
export { Button };
