import * as React from "react";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type NoticeTone = "info" | "warning" | "destructive" | "success";

interface InlineNoticeProps {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A trailing control, e.g. the retry or the link into settings. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "border-border bg-surface-inset text-foreground",
  success: "border-success/30 bg-success/10 text-foreground",
  warning: "border-warning/30 bg-warning/10 text-foreground",
  destructive: "border-destructive/30 bg-destructive/5 text-foreground",
};

const TONE_ICON_CLASSES: Record<NoticeTone, string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive-text",
};

const TONE_ICONS: Record<NoticeTone, React.ComponentType<{ className?: string }>> = {
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  destructive: TriangleAlertIcon,
};

/**
 * The one inline banner: a hairline border, a quiet tint, and an icon that carries the
 * tone. Replaces the ad-hoc warning/error bars that used to be re-written per page.
 */
export function InlineNotice({
  tone = "info",
  title,
  children,
  action,
  icon,
  className,
}: InlineNoticeProps) {
  const Icon = TONE_ICONS[tone];

  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 text-body",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className={cn("mt-0.5 shrink-0", TONE_ICON_CLASSES[tone])} aria-hidden="true">
        {icon ?? <Icon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold text-foreground">{title}</p> : null}
        {children ? (
          <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
