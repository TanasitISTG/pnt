import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { NovelForm } from "@/components/novels/form/novel-form";
import { NovelTagsCard } from "@/components/novels/form/novel-tags-card";
import { PublishMenu } from "@/components/publish-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNovelPublishState } from "@/components/novels/use-novel-publish-state";
import { updateNovel } from "@/lib/content/novel/novel.functions";
import type { UpdateNovelInput } from "@/lib/content/novel/novel.schemas";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";
import { publishState } from "@/lib/content/publish/publish";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import { translateServerError } from "@/lib/i18n/server-error";
import { emptyRelationshipMap } from "@/lib/relationships/map";
import { cn } from "@/lib/utils";

export interface StudioSettingsPageProps {
  novelId: string;
}

/**
 * The novel's own settings: metadata, the language pair, translation instructions and the
 * cover, plus its publishing switch. Saving stays on the page so a second field can be
 * corrected without navigating back in, and the language-pair guard the server enforces
 * surfaces here rather than in a toast that has already left.
 *
 * The width is the point: details and translation are two panels beside a sticky rail that
 * holds the things an owner changes for their own sake — the cover, the publishing switch,
 * the tags. Below a laptop the rail stacks under the form, and the cover stays in the details
 * panel because it belongs to the thing being edited.
 */
export function StudioSettingsPage({ novelId }: StudioSettingsPageProps) {
  const t = useTranslations("studio");
  const tRoot = useTranslations();
  const tCatalog = useTranslations("catalog");
  // The novel itself is a reader's object, so the one sentence here that is about the novel
  // rather than about editing it comes from the reader's namespace.
  const tNovel = useTranslations("novel");
  const localized = useLocalizedParams();
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

  const state = publishState(novel.publishedAt);
  const stateLabel =
    state === "live"
      ? tCatalog("stateLive")
      : state === "scheduled"
        ? tCatalog("stateScheduled")
        : tCatalog("stateDraft");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
          {t("settingsTitle")}
        </h1>
        <p className="mt-0.5 text-body text-muted-foreground">{t("settingsDescription")}</p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_21rem]">
        <NovelForm
          className="min-w-0"
          defaultValues={novel}
          onSubmit={async (data) => {
            await update({ ...data, novelId });
          }}
          submitLabel={t("saveChanges")}
        />

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
          <Card>
            <CardHeader>
              <CardTitle>{t("publishingTitle")}</CardTitle>
              <CardDescription>{t("publishingDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{t("publishingState")}</span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      state === "live"
                        ? "bg-success"
                        : state === "scheduled"
                          ? "bg-warning"
                          : "bg-muted-foreground",
                    )}
                  />
                  {stateLabel}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <PublishMenu
                  publishedAt={novel.publishedAt}
                  pending={publishing}
                  onChange={setPublishedAt}
                />
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to="/{-$locale}/novels/$novelId"
                      params={{ ...localized, novelId: novel.id }}
                    />
                  }
                >
                  {t("viewNovel")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tags are their own write: they belong to the vocabulary rather than to the novel
              row, and the form above saves metadata with one request. */}
          <NovelTagsCard novelId={novelId} tags={novel.tags} />
        </aside>
      </div>
    </div>
  );
}
