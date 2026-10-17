import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { NovelForm } from "@/components/novels/form/novel-form";
import { NovelTagsCard } from "@/components/novels/form/novel-tags-card";
import { PublishMenu } from "@/components/publish-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNovelPublishState } from "@/components/novels/use-novel-publish-state";
import { updateNovel } from "@/lib/content/novel/novel.functions";
import type { UpdateNovelInput } from "@/lib/content/novel/novel.schemas";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";
import { translateServerError } from "@/lib/i18n/server-error";
import { emptyRelationshipMap } from "@/lib/relationships/map";

export interface StudioSettingsPageProps {
  novelId: string;
}

/**
 * The novel's own settings: metadata, the language pair, translation instructions and the
 * cover, plus its publishing switch. Saving stays on the page so a second field can be
 * corrected without navigating back in, and the language-pair guard the server enforces
 * surfaces here rather than in a toast that has already left.
 */
export function StudioSettingsPage({ novelId }: StudioSettingsPageProps) {
  const t = useTranslations("studio");
  const tRoot = useTranslations();
  // The novel itself is a reader's object, so the one sentence here that is about the novel
  // rather than about editing it comes from the reader's namespace.
  const tNovel = useTranslations("novel");
  const queryClient = useQueryClient();
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const novel = novelQuery.data;
  const { publishing, setPublishedAt } = useNovelPublishState(novelId);

  const { mutateAsync: update } = useMutation({
    mutationFn: (vars: UpdateNovelInput) => updateNovel({ data: vars }),
    onSuccess: async (_result, variables) => {
      if (novel) {
        const nextSourceLang = variables.sourceLang ?? novel.sourceLang;
        const nextTargetLang = variables.targetLang ?? novel.targetLang;
        const languagePairChanged =
          nextSourceLang !== novel.sourceLang || nextTargetLang !== novel.targetLang;
        if (languagePairChanged) {
          queryClient.setQueryData(["novel", novelId], {
            ...novel,
            sourceLang: nextSourceLang,
            targetLang: nextTargetLang,
          });
          queryClient.setQueryData(["relationshipMap", novelId], emptyRelationshipMap());
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["novels"] }),
        queryClient.invalidateQueries({ queryKey: ["novel", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["readerNovel", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["relationshipMap", novelId] }),
      ]);
      toast.success(t("updated"));
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("updateFailed")));
    },
  });

  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">{tNovel("notFoundTitle")}</h2>
        <p className="mt-2 text-muted-foreground">{t("notFoundDescription")}</p>
        <Button className="mt-4" render={<Link to="/library" />}>
          {t("backToLibrary")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
          {t("settingsTitle")}
        </h1>
        <p className="mt-0.5 text-body text-muted-foreground">{t("settingsDescription")}</p>
      </div>

      <NovelForm
        defaultValues={novel}
        onSubmit={async (data) => {
          await update({ ...data, novelId });
        }}
        submitLabel={t("saveChanges")}
      />

      {/* Tags are their own write: they belong to the vocabulary rather than to the novel
          row, and the form above saves metadata with one request. */}
      <NovelTagsCard novelId={novelId} tags={novel.tags} />

      <Card className="max-w-3xl">
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-card-title font-semibold text-foreground">
              {t("publishingTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("publishingDescription")}</p>
          </div>
          <PublishMenu
            publishedAt={novel.publishedAt}
            pending={publishing}
            onChange={setPublishedAt}
          />
        </CardContent>
      </Card>
    </div>
  );
}
