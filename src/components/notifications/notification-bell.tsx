"use client";

import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  BookOpen,
  CornerDownRight,
  MessageSquare,
  ShieldCheck,
  Star,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import { markNotificationsRead } from "@/lib/notifications/functions";
import { notificationKeys, notificationsQueryOptions } from "@/lib/notifications/query";
import type {
  NotificationItem,
  NotificationKind,
  NotificationPage,
} from "@/lib/notifications/types";
import type { NotificationMessage } from "@/lib/notifications/channels";
import { cn } from "@/lib/utils";
import { useNotificationStream } from "./use-notification-stream";

/**
 * The bell: the unread count, the newest rows, and the one action that clears them.
 *
 * It reads `notificationsQueryOptions`, which polls, and listens on the account's Ably
 * channel, which usually answers sooner. Both paths end in the same refetch, so the socket is
 * an accelerator and the poll is the guarantee — a deployment without an Ably key renders and
 * behaves exactly the same, only later.
 *
 * The row is deliberately typed before it is read: a small kind label, then the thing the
 * event is about, then the comment or review as a quoted excerpt. A sentence that embeds the
 * novel title reads like the words underneath it, which is the one thing this surface must
 * never do.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const localized = useLocalizedParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(notificationsQueryOptions());
  const unreadCount = query.data?.unreadCount ?? 0;
  const groups = useMemo(() => groupByDay(query.data?.items ?? []), [query.data?.items]);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead({ data: { ids } }),
    onSuccess: (result, ids) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<NotificationPage>(notificationKeys.all, (previous) =>
        previous
          ? {
              ...previous,
              unreadCount: result.unreadCount,
              // Only the rows the request named move: opening one item must not appear to
              // clear its neighbours before the invalidated list arrives.
              items: previous.items.map((item) =>
                !item.readAt && (!ids || ids.includes(item.id)) ? { ...item, readAt: now } : item,
              ),
            }
          : previous,
      );
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("markReadFailed"));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  const openTarget = useCallback(
    (message: NotificationMessage) => {
      if (!message.novelId || !message.chapterId) return;
      void navigate({
        to: "/{-$locale}/novels/$novelId/chapters/$chapterId",
        params: {
          ...localized,
          novelId: message.novelId,
          chapterId: message.chapterId,
        },
      });
    },
    [localized, navigate],
  );

  // One toast per arrival, so a client that receives the same message twice (a reconnect can
  // replay) still shows one. The row it names is already invalidated above.
  const onArrival = useCallback(
    (message: NotificationMessage) => {
      const view = describeNotification(message, t);
      toast(view.label, {
        id: `notification:${message.id}`,
        description: toastDescription(view),
        action:
          message.novelId && message.chapterId
            ? { label: t("toastOpen"), onClick: () => openTarget(message) }
            : undefined,
      });
    },
    [openTarget, t],
  );

  useNotificationStream(userId, onArrival);

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="iconPill" className="relative" />}
        aria-label={t("bellLabel", { count: unreadCount })}
        title={t("title")}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-badge-count leading-4 font-medium text-primary-foreground tabular-nums"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-[min(26rem,calc(100vw-2rem))]">
        <div className="-m-3">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-popover/95 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <PopoverTitle>{t("title")}</PopoverTitle>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {t("bellLabel", { count: unreadCount })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 shrink-0"
              onClick={() => markRead.mutate(undefined)}
              disabled={unreadCount === 0 || markRead.isPending}
            >
              {t("markAllRead")}
            </Button>
          </div>

          {query.isPending ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-surface-inset text-muted-foreground">
                <BellOff className="size-4" aria-hidden="true" />
              </span>
              <p className="mt-3 text-body font-medium text-foreground">{t("emptyTitle")}</p>
              <p className="mt-1 max-w-64 text-sm text-muted-foreground">{t("emptyDescription")}</p>
            </div>
          ) : (
            <div className="px-2.5 py-2">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`notification-day-${group.key}`}>
                  <h3
                    id={`notification-day-${group.key}`}
                    className="px-2 pt-2 pb-1.5 text-micro font-medium text-muted-foreground"
                  >
                    {t(group.key)}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NotificationRow
                        key={item.id}
                        item={item}
                        locale={locale}
                        onRead={() => {
                          if (!item.readAt) markRead.mutate([item.id]);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  locale,
  onRead,
}: {
  item: NotificationItem;
  locale: Locale;
  onRead: () => void;
}) {
  const t = useTranslations("notifications");
  const localized = useLocalizedParams();
  const view = describeNotification(item, t);
  const Icon = KIND_ICON[item.kind];

  const className = cn(
    "flex w-full items-start gap-3 rounded-xl px-2.5 py-3 text-left no-underline outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
    item.readAt ? "hover:bg-surface-inset" : "bg-surface-inset hover:bg-border/30",
  );
  const body = (
    <>
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          item.readAt ? "bg-surface-inset text-muted-foreground" : "bg-background text-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-micro font-medium",
              item.readAt ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {view.label}
          </span>
          {!item.readAt ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          ) : null}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-sm leading-snug",
            view.excerpt ? "line-clamp-2" : "line-clamp-3",
            item.readAt ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {view.headline}
        </span>
        {view.context ? (
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            {view.context}
          </span>
        ) : null}
        {view.excerpt ? (
          <span className="mt-2 block line-clamp-2 rounded-md border-l-2 border-border bg-background/60 px-2.5 py-1.5 text-caption leading-relaxed text-foreground/80">
            {view.excerpt}
          </span>
        ) : null}
        <span className="mt-1.5 block text-micro text-muted-foreground">
          {formatRelativeTime(item.createdAt, locale)}
        </span>
      </span>
    </>
  );

  if (item.novelId && item.chapterId) {
    return (
      <li>
        <Link
          to="/{-$locale}/novels/$novelId/chapters/$chapterId"
          params={{ ...localized, novelId: item.novelId, chapterId: item.chapterId }}
          className={className}
          onClick={onRead}
        >
          {body}
        </Link>
      </li>
    );
  }

  // A report has no chapter to open, so the row itself is the action that clears it. Without
  // this the only way to mark one read is the header's mark-all.
  return (
    <li>
      <button type="button" className={className} onClick={onRead}>
        {body}
      </button>
    </li>
  );
}

type NotificationCopy = Pick<
  NotificationItem,
  "kind" | "novelTitle" | "chapterTitle" | "detail" | "outcome"
>;

interface NotificationView {
  kind: NotificationKind;
  label: string;
  headline: string;
  context: string | null;
  excerpt: string | null;
}

type NotificationTranslator = (
  key:
    | "kindChapter"
    | "kindComment"
    | "kindReply"
    | "kindReview"
    | "kindReport"
    | "chapterFallback"
    | "reportUpheldHeadline"
    | "reportDismissedHeadline",
) => string;

/**
 * What every kind prints, in the one place both the row and the arrival toast read it.
 *
 * The excerpt only exists for the kinds that carry somebody's words; a new chapter already
 * names itself in `detail`. A report whose target was a comment or a review has no title to
 * name, so its context is simply absent rather than an empty line.
 */
function describeNotification(item: NotificationCopy, t: NotificationTranslator): NotificationView {
  switch (item.kind) {
    case "chapter_published":
      return {
        kind: item.kind,
        label: t("kindChapter"),
        headline: item.detail || t("chapterFallback"),
        context: item.novelTitle || null,
        excerpt: null,
      };
    case "novel_comment":
      return {
        kind: item.kind,
        label: t("kindComment"),
        headline: item.novelTitle,
        context: item.chapterTitle,
        excerpt: item.detail,
      };
    case "comment_reply":
      return {
        kind: item.kind,
        label: t("kindReply"),
        headline: item.novelTitle,
        context: item.chapterTitle,
        excerpt: item.detail,
      };
    case "novel_review":
      return {
        kind: item.kind,
        label: t("kindReview"),
        headline: item.novelTitle,
        context: null,
        excerpt: item.detail,
      };
    case "report_decided":
      return {
        kind: item.kind,
        label: t("kindReport"),
        headline:
          item.outcome === "upheld" ? t("reportUpheldHeadline") : t("reportDismissedHeadline"),
        context: item.novelTitle || null,
        excerpt: null,
      };
  }
}

/** The toast is a notification, not a second copy of the row: one line of context, at most. */
function toastDescription(view: NotificationView): string {
  if (view.kind === "chapter_published" || view.kind === "report_decided") {
    return [view.headline, view.context].filter(Boolean).join(" · ");
  }
  return [view.headline, view.excerpt].filter(Boolean).join(" · ");
}

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  chapter_published: BookOpen,
  comment_reply: CornerDownRight,
  novel_comment: MessageSquare,
  novel_review: Star,
  report_decided: ShieldCheck,
};

type DayGroupKey = "today" | "yesterday" | "earlier";

const DAY_MS = 86_400_000;
const DAY_ORDER: DayGroupKey[] = ["today", "yesterday", "earlier"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayGroupFor(iso: string, now: Date): DayGroupKey {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return "earlier";
}

function groupByDay(
  items: NotificationItem[],
  now: Date = new Date(),
): Array<{ key: DayGroupKey; items: NotificationItem[] }> {
  const buckets = new Map<DayGroupKey, NotificationItem[]>();
  for (const item of items) {
    const key = dayGroupFor(item.createdAt, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return DAY_ORDER.flatMap((key) => {
    const group = buckets.get(key);
    return group ? [{ key, items: group }] : [];
  });
}
