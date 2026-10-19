import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { setNovelTags } from "@/lib/content/novel/tag.functions";
import { MAX_NOVEL_TAGS } from "@/lib/content/novel/catalog.schemas";
import type { CatalogTagRef } from "@/lib/content/novel/catalog.types";
import { translateServerError } from "@/lib/i18n/server-error";

/**
 * The tags a novel carries.
 *
 * A tag is written once here and read everywhere else — the card, the catalog's filter row,
 * the tag's own filter. The write is a set, so adding and removing are the same request:
 * this sends the list the novel should have, and the server converges to it in one
 * transaction. The server's answer becomes the local list, because the slug it derives is
 * what the filter links by.
 */
export function NovelTagsCard({ novelId, tags }: { novelId: string; tags: CatalogTagRef[] }) {
  const t = useTranslations("tags");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  // The novel's own read is the source, and the last saved answer is the local one until it
  // changes. Deriving that during render (rather than syncing in an effect) is what the
  // toolbar does with its search box, and it keeps a refetch from clobbering a draft.
  const [shown, setShown] = useState({ source: tags, value: tags });
  if (shown.source !== tags) setShown({ source: tags, value: tags });
  const local = shown.value;

  const save = useMutation({
    mutationFn: (next: CatalogTagRef[]) =>
      setNovelTags({ data: { novelId, tags: next.map((tag) => tag.name) } }),
    onSuccess: (result) => {
      setShown({ source: tags, value: result.tags });
      void queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      void queryClient.invalidateQueries({ queryKey: ["novels"] });
      void queryClient.invalidateQueries({ queryKey: ["catalogTags"] });
    },
    onError: (error: unknown) => toast.error(translateServerError(error, tRoot, t("saveFailed"))),
  });

  const add = () => {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (local.length >= MAX_NOVEL_TAGS) {
      toast.error(t("maxReached", { max: MAX_NOVEL_TAGS }));
      return;
    }
    if (local.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      toast.error(t("duplicate"));
      return;
    }
    setDraft("");
    save.mutate([...local, { slug: "", name }]);
  };

  const remove = (slug: string, name: string) => {
    save.mutate(local.filter((tag) => (slug ? tag.slug !== slug : tag.name !== name)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description", { max: MAX_NOVEL_TAGS })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {local.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {local.map((tag) => (
              <li key={tag.slug || tag.name}>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pr-1 pl-2.5 text-caption text-foreground">
                  {tag.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("remove", { name: tag.name })}
                    disabled={save.isPending}
                    onClick={() => remove(tag.slug, tag.name)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <Input
            value={draft}
            autoComplete="off"
            maxLength={80}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            disabled={save.isPending || local.length >= MAX_NOVEL_TAGS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={save.isPending || draft.trim() === "" || local.length >= MAX_NOVEL_TAGS}
            onClick={add}
          >
            <Check className="size-4" aria-hidden="true" />
            {t("add")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
