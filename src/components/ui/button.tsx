import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-base whitespace-nowrap transition-all outline-none select-none focus-visible:shadow-focus active:opacity-80 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary Dark — charcoal, off-white text, signature inset shadow
        default: "bg-primary text-primary-foreground shadow-button-inset",
        // Ghost / Outline — transparent, interactive 40% border
        outline: "border-foreground/40 bg-transparent text-foreground",
        // Borderless — subtle charcoal tint on hover
        ghost: "text-foreground hover:bg-foreground/4",
        // Cream Surface — tertiary, toolbar
        cream: "bg-surface text-foreground",
        // Pill / Icon — 9999px, inset shadow, opacity-driven
        pill: "rounded-full bg-surface text-foreground shadow-button-inset opacity-50 hover:opacity-80",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-button-inset",
        link: "text-foreground underline underline-offset-4",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-sm",
        lg: "h-11 px-5",
        icon: "size-10 rounded-full",
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

export { Button, buttonVariants };
