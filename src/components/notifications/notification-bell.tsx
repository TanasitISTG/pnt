"use client";

import { useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BookOpen, MessageCircle, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import { markNotificationsRead } from "@/lib/notifications/functions";
import { notificationKeys, notificationsQueryOptions } from "@/lib/notifications/query";
import type { NotificationItem, NotificationPage } from "@/lib/notifications/types";
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
 */
export function NotificationBell({ userId }: { userId: string }) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const localized = useLocalizedParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(notificationsQueryOptions());
  const unreadCount = query.data?.unreadCount ?? 0;

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
      const title = toastTitleFor(t, message.kind);
      const description = sentenceFor(t, message.kind, {
        novelTitle: message.novelTitle,
        outcome: message.outcome,
      });

      toast(title, {
        id: `notification:${message.id}`,
        description,
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
      <PopoverContent side="bottom" align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PopoverTitle>{t("title")}</PopoverTitle>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-9"
            onClick={() => markRead.mutate(undefined)}
            disabled={unreadCount === 0 || markRead.isPending}
          >
            {t("markAllRead")}
          </Button>
        </div>

        {query.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
        ) : !query.data || query.data.items.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="text-body font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
          </div>
        ) : (
          <ul className="-mx-1 flex flex-col">
            {query.data.items.map((item) => (
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
        )}
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

  const sentence = sentenceFor(t, item.kind, {
    novelTitle: item.novelTitle,
    outcome: item.outcome,
  });

  const Icon =
    item.kind === "chapter_published"
      ? BookOpen
      : item.kind === "novel_review"
        ? Star
        : item.kind === "report_decided"
          ? ShieldCheck
          : MessageCircle;

  const body = (
    <>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-snug",
            item.readAt ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {sentence}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            {item.detail}
          </span>
        ) : null}
        <span className="mt-1 block text-micro text-muted-foreground">
          {formatRelativeTime(item.createdAt, locale)}
        </span>
      </span>
      {!item.readAt ? (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      ) : null}
    </>
  );

  const className = cn(
    "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left no-underline transition-colors hover:bg-surface-2",
    !item.readAt && "bg-surface-inset",
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

  return (
    <li>
      <div className={className}>{body}</div>
    </li>
  );
}

/**
 * The one sentence each kind prints, shared by the list row and the arrival toast so the two
 * cannot word the same event differently. A report whose target was a comment or a review has
 * no title to name, so its sentence drops the novel rather than printing an empty one.
 */
type SentenceTranslator = (
  key:
    | "chapterPublished"
    | "commentReply"
    | "novelComment"
    | "novelReview"
    | "reportUpheld"
    | "reportDismissed"
    | "reportUpheldNoNovel"
    | "reportDismissedNoNovel",
  values?: { novel: string },
) => string;

function sentenceFor(
  t: SentenceTranslator,
  kind: NotificationItem["kind"],
  copy: { novelTitle: string; outcome: NotificationItem["outcome"] },
): string {
  switch (kind) {
    case "chapter_published":
      return t("chapterPublished", { novel: copy.novelTitle });
    case "comment_reply":
      return t("commentReply", { novel: copy.novelTitle });
    case "novel_comment":
      return t("novelComment", { novel: copy.novelTitle });
    case "novel_review":
      return t("novelReview", { novel: copy.novelTitle });
    case "report_decided":
      if (copy.outcome === "upheld") {
        return copy.novelTitle
          ? t("reportUpheld", { novel: copy.novelTitle })
          : t("reportUpheldNoNovel");
      }
      return copy.novelTitle
        ? t("reportDismissed", { novel: copy.novelTitle })
        : t("reportDismissedNoNovel");
  }
}

type ToastTitleTranslator = (
  key:
    | "toastChapterTitle"
    | "toastReplyTitle"
    | "toastCommentTitle"
    | "toastReviewTitle"
    | "toastReportTitle",
) => string;

function toastTitleFor(t: ToastTitleTranslator, kind: NotificationItem["kind"]): string {
  switch (kind) {
    case "chapter_published":
      return t("toastChapterTitle");
    case "comment_reply":
      return t("toastReplyTitle");
    case "novel_comment":
      return t("toastCommentTitle");
    case "novel_review":
      return t("toastReviewTitle");
    case "report_decided":
      return t("toastReportTitle");
  }
}
