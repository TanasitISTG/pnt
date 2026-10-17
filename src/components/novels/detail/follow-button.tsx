"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, BellRing } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { setNovelFollow } from "@/lib/notifications/functions";
import { novelFollowQueryKey, novelFollowQueryOptions } from "@/lib/notifications/query";
import type { NovelFollowState } from "@/lib/notifications/types";

/**
 * Follow turns a novel the reader is already reading into one the app will tell them about.
 *
 * A guest is offered the button too and is sent to sign in, because following is account
 * state with nowhere to live in a browser. The owner sees nothing: following your own novel
 * would only notify you about your own work, and the server refuses it anyway.
 */
export function FollowButton({
  novelId,
  signedIn,
  isOwner,
}: {
  novelId: string;
  signedIn: boolean;
  isOwner: boolean;
}) {
  const t = useTranslations("novel");

  if (!signedIn) {
    return (
      <Button size="sm" variant="outline" render={<Link to="/{-$locale}/login" />}>
        <BellPlus className="size-4" aria-hidden="true" />
        {t("follow")}
      </Button>
    );
  }

  if (isOwner) return null;

  return <FollowToggle novelId={novelId} />;
}

/**
 * The toggle is optimistic and rolls back on failure, so the button answers the tap
 * immediately while the server has the last word.
 */
function FollowToggle({ novelId }: { novelId: string }) {
  const t = useTranslations("novel");
  const queryClient = useQueryClient();
  const query = useQuery(novelFollowQueryOptions(novelId));
  const [pending, setPending] = useState(false);
  const following = query.data?.following ?? false;

  const mutation = useMutation({
    mutationFn: (next: boolean) => setNovelFollow({ data: { novelId, following: next } }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: novelFollowQueryKey(novelId) });
      const previous = queryClient.getQueryData<NovelFollowState>(novelFollowQueryKey(novelId));
      queryClient.setQueryData<NovelFollowState>(novelFollowQueryKey(novelId), {
        following: next,
      });
      return { previous };
    },
    onError: (error: unknown, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(novelFollowQueryKey(novelId), context.previous);
      }
      toast.error(error instanceof Error ? error.message : t("followFailed"));
    },
    onSettled: () => {
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: novelFollowQueryKey(novelId) });
    },
  });

  if (query.isPending && !query.data) {
    return (
      <span
        className="h-8 w-24 motion-safe:animate-pulse rounded-md bg-surface-inset"
        aria-label={t("loadingActions")}
      />
    );
  }

  return (
    <Button
      size="sm"
      variant={following ? "ghostMuted" : "outline"}
      aria-pressed={following}
      disabled={pending || mutation.isPending}
      onClick={() => {
        setPending(true);
        mutation.mutate(!following);
      }}
    >
      {following ? (
        <BellRing className="size-4" aria-hidden="true" />
      ) : (
        <BellPlus className="size-4" aria-hidden="true" />
      )}
      {following ? t("following") : t("follow")}
    </Button>
  );
}
