import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Merge } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mergeAuthors, searchAuthors } from "@/lib/content/novel/author.functions";
import { translateServerError } from "@/lib/i18n/server-error";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import { cn } from "@/lib/utils";
import type { CatalogAuthor } from "@/lib/content/novel/catalog.types";

/**
 * The operator's correction for a duplicate author.
 *
 * `novels.author` is free text, so one person can arrive as "Liu Cixin" and "liu cixin" and
 * become two pages. Merging is a deliberate, audited act rather than a background guess:
 * it repoints novels, rewrites their author text to the surviving spelling, and sends the
 * operator to the page that now holds everything.
 *
 * It is offered on the author page and only to an operator, because that is where the
 * duplicate is visible — not in a fourth admin tab nobody would think to open.
 */
export function MergeAuthorControl({ author }: { author: CatalogAuthor }) {
  const t = useTranslations("authors");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const localized = useLocalizedParams();

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);

  const candidates = useQuery({
    queryKey: ["authorSearch", term] as const,
    queryFn: () => searchAuthors({ data: { term } }),
    enabled: open && term.trim().length >= 2,
    staleTime: 30_000,
  });

  const merge = useMutation({
    mutationFn: (intoAuthorId: string) =>
      mergeAuthors({ data: { fromAuthorId: author.id, intoAuthorId } }),
    onSuccess: (result, intoAuthorId) => {
      toast.success(t("mergeDone", { count: result.moved, name: result.name }));
      void queryClient.invalidateQueries({ queryKey: ["novels"] });
      void queryClient.invalidateQueries({ queryKey: ["catalogTags"] });
      setOpen(false);
      void navigate({
        to: "/{-$locale}/authors/$authorId",
        params: { authorId: intoAuthorId, ...localized },
      });
    },
    onError: (error: unknown) => toast.error(translateServerError(error, tRoot, t("mergeFailed"))),
  });

  return (
    <>
      <Button variant="outline" className="self-start sm:self-auto" onClick={() => setOpen(true)}>
        <Merge className="size-4" aria-hidden="true" />
        {t("mergeAction")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setTerm("");
            setTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mergeTitle", { name: author.name })}</DialogTitle>
            <DialogDescription>{t("mergeDescription")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Input
              autoComplete="off"
              value={term}
              placeholder={t("mergeSearchPlaceholder")}
              aria-label={t("mergeSearchLabel")}
              onChange={(event) => {
                setTerm(event.target.value);
                setTarget(null);
              }}
            />
            {candidates.data && candidates.data.length > 0 ? (
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
                {candidates.data
                  .filter((candidate) => candidate.id !== author.id)
                  .map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => setTarget(candidate)}
                        aria-pressed={target?.id === candidate.id}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-body transition-colors duration-150",
                          target?.id === candidate.id
                            ? "bg-surface text-foreground"
                            : "text-muted-foreground hover:bg-surface hover:text-foreground",
                        )}
                      >
                        {candidate.name}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : term.trim().length >= 2 && candidates.isSuccess ? (
              <p className="text-caption text-muted-foreground">{t("mergeNoMatches")}</p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={merge.isPending} />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button
              disabled={!target || merge.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (target) merge.mutate(target.id);
              }}
            >
              {merge.isPending ? tCommon("saving") : t("mergeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
