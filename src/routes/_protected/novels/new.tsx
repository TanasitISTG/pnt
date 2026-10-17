import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { createNovel } from "@/lib/content/novel/novel.functions";
import type { CreateNovelInput } from "@/lib/content/novel/novel.schemas";
import { translateServerError } from "@/lib/i18n/server-error";
import { NovelForm } from "@/components/novels/form/novel-form";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_protected/novels/new")({
  component: NewNovelPage,
});

function NewNovelPage() {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { mutateAsync: create } = useMutation({
    mutationFn: (vars: CreateNovelInput) => createNovel({ data: vars }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success(t("created"));
      // A new novel has no chapters, so the next step is the studio's add flow rather than
      // a reading page that would have nothing to read.
      navigate({ to: "/novels/$novelId/manage/add", params: { novelId: data.id } });
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("createFailed")));
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label={tCommon("back")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-section font-semibold text-foreground tracking-tight">
            {t("newTitle")}
          </h1>
          <p className="text-body text-muted-foreground mt-0.5">{t("newDescription")}</p>
        </div>
      </div>

      <NovelForm
        onSubmit={async (data) => {
          await create(data);
        }}
        submitLabel={t("createNovel")}
      />
    </div>
  );
}
