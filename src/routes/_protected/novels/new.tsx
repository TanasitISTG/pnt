import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { createNovel } from "@/lib/novel.functions";
import { NovelForm } from "@/components/novel-form";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_protected/novels/new")({
  component: NewNovelPage,
});

function NewNovelPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { mutateAsync: create, isPending } = useMutation({
    mutationFn: (vars: any) => createNovel({ data: vars }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Novel created successfully");
      navigate({ to: "/novels/$novelId", params: { novelId: data.id } });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create novel");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label="Go back">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-section font-semibold text-foreground tracking-tight">
            Create New Novel
          </h1>
          <p className="text-body text-muted-foreground mt-0.5">
            Configure your translation language pair and settings.
          </p>
        </div>
      </div>

      <NovelForm
        onSubmit={async (data) => {
          await create(data);
        }}
        submitLabel="Create Novel"
        pending={isPending}
      />
    </div>
  );
}
