import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { getNovel, updateNovel } from "@/lib/novel.functions";
import { NovelForm } from "@/components/novel-form";
import { Button } from "@/components/ui/button";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

export const Route = createFileRoute("/_protected/novels/$novelId/edit")({
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
  component: EditNovelPage,
});

function EditNovelPage() {
  const { novelId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: novel } = useQuery(novelQueryOptions(novelId));

  const { mutateAsync: update, isPending } = useMutation({
    mutationFn: (vars: any) => updateNovel({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      toast.success("Novel updated successfully");
      navigate({ to: "/novels/$novelId", params: { novelId } });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update novel");
    },
  });

  if (!novel) {
    return (
      <div className="text-center py-12">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="text-muted-foreground mt-2">
          The novel you are trying to edit does not exist or you don't have access.
        </p>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="Go back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
            {novel.title}
          </h1>
          <p className="text-body text-muted-foreground mt-0.5">
            Modify your novel details and instructions.
          </p>
        </div>
      </div>

      <NovelForm
        defaultValues={novel}
        onSubmit={async (data) => {
          await update({ ...data, novelId });
        }}
        submitLabel="Save Changes"
        pending={isPending}
      />
    </div>
  );
}
