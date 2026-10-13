import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { NovelForm } from "@/components/novels/form/novel-form";
import { PublishMenu } from "@/components/publish-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNovelPublishState } from "@/components/novels/use-novel-publish-state";
import { updateNovel } from "@/lib/content/novel/novel.functions";
import type { UpdateNovelInput } from "@/lib/content/novel/novel.schemas";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";
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
      toast.success("Novel updated successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update novel");
    },
  });

  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="mt-2 text-muted-foreground">
          The novel you are trying to edit does not exist or you do not have access.
        </p>
        <Button className="mt-4" render={<Link to="/library" />}>
          Back to your library
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
          Novel settings
        </h1>
        <p className="mt-0.5 text-body text-muted-foreground">
          Details, language pair and translation instructions for this novel.
        </p>
      </div>

      <NovelForm
        defaultValues={novel}
        onSubmit={async (data) => {
          await update({ ...data, novelId });
        }}
        submitLabel="Save Changes"
      />

      <Card className="max-w-3xl">
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-card-title font-semibold text-foreground">Publishing</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Guests can see this novel and its published chapters once it is live. Chapters are
              published individually from the chapter list.
            </p>
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
