import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { setNovelPublished } from "@/lib/content/novel/novel.functions";
import { translateServerError } from "@/lib/i18n/server-error";

/**
 * Publishing is the one novel mutation the reading page and the studio both offer, because
 * it is the one the owner decides about while looking at the result. Keeping it in one hook
 * means the two surfaces invalidate the same keys and phrase the result the same way.
 */
export function useNovelPublishState(novelId: string) {
  const t = useTranslations("studio");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationFn: (publishedAt: Date | null) => setNovelPublished({ data: { novelId, publishedAt } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      toast.success(t("publishingUpdated"));
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("publishingUpdateFailed")));
    },
  });

  return { publishing: isPending, setPublishedAt: mutate };
}
