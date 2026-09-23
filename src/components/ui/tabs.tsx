import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

type TabsListVariant = "default" | "choice";
type TabsTriggerVariant = "default" | "choice";
type TabsContentVariant = "default" | "surface";

const tabsListClasses = {
  default: "inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1",
  choice:
    "grid w-full items-center grid-cols-1 gap-2 rounded-none border-0 bg-transparent p-0 min-[640px]:grid-cols-3",
} satisfies Record<TabsListVariant, string>;

const tabsTriggerClasses = {
  default:
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:bg-background data-active:text-foreground data-active:shadow-sm disabled:pointer-events-none disabled:opacity-50",
  choice:
    "inline-flex min-h-28 items-start justify-start gap-2 rounded-xl border border-border bg-background px-4 py-4 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:border-primary data-active:bg-surface-2 data-active:text-foreground data-active:shadow-none disabled:pointer-events-none disabled:opacity-50",
} satisfies Record<TabsTriggerVariant, string>;

const tabsContentClasses = {
  default: "min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  surface:
    "min-w-0 rounded-2xl border border-border bg-surface p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-6",
} satisfies Record<TabsContentVariant, string>;

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & { variant?: TabsListVariant }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(tabsListClasses[variant], className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.Tab.Props & { variant?: TabsTriggerVariant }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerClasses[variant], className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.Panel.Props & { variant?: TabsContentVariant }) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(tabsContentClasses[variant], className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
