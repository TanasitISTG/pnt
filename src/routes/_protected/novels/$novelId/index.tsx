import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { ArrowLeft, Edit, Trash2, FileText, X, Check } from "lucide-react";
import { toast } from "sonner";
import { NovelCover } from "@/components/novel-cover";

import {
  getNovel,
  getChapter,
  deleteNovel,
  listChapters,
  createChapter,
  deleteChapter,
  updateChapterRaw,
} from "@/lib/novel.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChapterStatusBadge } from "@/components/chapter-status-badge";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { createChapterSchema, updateChapterSchema } from "@/lib/novel.schemas";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
  });

export const Route = createFileRoute("/_protected/novels/$novelId/")({
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
    ]);
  },
  component: NovelDetailPage,
});

interface EditState {
  chapterId: string;
  number: string;
  title: string;
  rawContent: string;
  contentLoading: boolean;
}

function NovelDetailPage() {
  const { novelId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: novel } = useQuery(novelQueryOptions(novelId));
  const { data: chapters = [] } = useQuery(chaptersQueryOptions(novelId));

  // Dialog States
  const [deleteNovelOpen, setDeleteNovelOpen] = useState(false);
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);

  // Chapter edit state
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Add chapter form state
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNum = Math.max(...chapters.map((c) => Number(c.number || 0)), 0);
    return Math.floor(maxNum) + 1;
  }, [chapters]);

  const [chapNumber, setChapNumber] = useState<string>(autoNextNumber.toString());
  const [chapTitle, setChapTitle] = useState("");
  const [chapContent, setChapContent] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { mutateAsync: removeNovel, isPending: deletingNovel } = useMutation({
    mutationFn: () => deleteNovel({ data: { novelId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Novel deleted successfully");
      navigate({ to: "/" });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete novel");
    },
  });

  const { mutateAsync: addChapter, isPending: addingChapter } = useMutation({
    mutationFn: (vars: any) => createChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Chapter added successfully");
      setChapTitle("");
      setChapContent("");
      setFormErrors({});
      const nextNum = Number(chapNumber) + 1;
      setChapNumber(isNaN(nextNum) ? "" : nextNum.toString());
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add chapter");
    },
  });

  const { mutateAsync: removeChapter, isPending: deletingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string }) => deleteChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Chapter deleted successfully");
      setDeleteChapterId(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete chapter");
    },
  });

  const { mutateAsync: saveChapterEdit, isPending: savingEdit } = useMutation({
    mutationFn: (vars: any) => updateChapterRaw({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Chapter updated");
      setEditState(null);
      setEditErrors({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update chapter");
    },
  });

  const handleAddChapter = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormErrors({});

    const num = Number(chapNumber);
    const payload = { novelId, number: num, title: chapTitle, rawContent: chapContent };

    const result = createChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setFormErrors(fieldErrors);
      return;
    }

    await addChapter(payload);
  };

  const handleStartEdit = async (chapter: (typeof chapters)[0]) => {
    setEditState({
      chapterId: chapter.id,
      number: String(Number(chapter.number)),
      title: chapter.title,
      rawContent: "",
      contentLoading: true,
    });
    setEditErrors({});

    try {
      const full = await getChapter({ data: { chapterId: chapter.id } });
      setEditState((s) =>
        s?.chapterId === chapter.id
          ? { ...s, rawContent: full?.rawContent ?? "", contentLoading: false }
          : s,
      );
    } catch {
      setEditState((s) => (s?.chapterId === chapter.id ? { ...s, contentLoading: false } : s));
      toast.error("Failed to load chapter content");
    }
  };

  const handleSaveEdit = async () => {
    setEditErrors({});
    if (!editState) return;

    const payload = {
      chapterId: editState.chapterId,
      number: Number(editState.number),
      title: editState.title,
      rawContent: editState.rawContent,
    };

    const result = updateChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setEditErrors(fieldErrors);
      return;
    }

    await saveChapterEdit(payload);
  };

  const progressPercent = useMemo(() => {
    if (chapters.length === 0) return 0;
    const translatedCount = chapters.filter((c) => c.status === "translated").length;
    return Math.round((translatedCount / chapters.length) * 100);
  }, [chapters]);

  if (!novel) {
    return (
      <div className="text-center py-12">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="text-muted-foreground mt-2">The novel you are looking for does not exist.</p>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  const editingChapter = editState ? chapters.find((c) => c.id === editState.chapterId) : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Novel Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label="Go to Library">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/novels/$novelId/edit" params={{ novelId }} />}
            >
              <Edit className="size-4" />
              Edit
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteNovelOpen(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
          <div className="relative aspect-3/4 w-full max-w-[200px] overflow-hidden rounded-xl border border-border bg-foreground/3 flex items-center justify-center self-start">
            <NovelCover
              novelId={novel.id}
              cover={novel.cover}
              alt={novel.title}
              className="h-full w-full object-cover"
              fallbackSize={16}
            />
          </div>

          <div className="flex flex-col gap-4 flex-1">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
                  {novel.title}
                </h1>
                <Badge
                  variant="outline"
                  className="uppercase font-semibold text-xs border-foreground/40"
                >
                  {novel.sourceLang} → {novel.targetLang}
                </Badge>
              </div>
              {novel.originalTitle && (
                <p className="text-body text-muted-foreground mt-1 font-medium">
                  {novel.originalTitle}
                </p>
              )}
              {novel.author && (
                <p className="text-sm text-muted-foreground mt-0.5">By {novel.author}</p>
              )}
            </div>

            {novel.description && (
              <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed whitespace-pre-wrap">
                {novel.description}
              </p>
            )}

            <div className="max-w-md pt-2 flex flex-col gap-1.5">
              <div className="flex justify-between text-caption text-muted-foreground">
                <span>Overall Translation Progress</span>
                <span>
                  {progressPercent}% ({chapters.filter((c) => c.status === "translated").length}/
                  {chapters.length} chapters)
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          </div>
        </div>
      </div>

      <hr className="border-border" />

      {/* Chapters Table */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sub font-semibold text-foreground tracking-tight">Chapters</h2>

        {chapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
            <FileText className="size-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No chapters in this novel yet. Paste one below to start.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-32">Chars</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chapters.map((chapter) => (
                  <TableRow
                    key={chapter.id}
                    data-editing={editState?.chapterId === chapter.id ? "true" : undefined}
                    className="data-[editing=true]:bg-muted/50"
                  >
                    <TableCell className="font-medium">{Number(chapter.number)}</TableCell>
                    <TableCell className="font-medium">{chapter.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {chapter.rawCharCount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <ChapterStatusBadge status={chapter.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() =>
                            editState?.chapterId === chapter.id
                              ? setEditState(null)
                              : handleStartEdit(chapter)
                          }
                          aria-label={
                            editState?.chapterId === chapter.id ? "Cancel edit" : "Edit chapter"
                          }
                        >
                          {editState?.chapterId === chapter.id ? (
                            <X className="size-4 text-muted-foreground" />
                          ) : (
                            <Edit className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDeleteChapterId(chapter.id)}
                          aria-label="Delete chapter"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Inline chapter editor (below table) */}
        {editState && editingChapter && (
          <Card className="border-foreground/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-card-title font-semibold text-foreground">
                  Editing: {editingChapter.title}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    setEditState(null);
                    setEditErrors({});
                  }}
                  aria-label="Close editor"
                >
                  <X className="size-4" />
                </Button>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1.5 sm:col-span-1">
                    <Label htmlFor="edit-chapNumber">Number *</Label>
                    <Input
                      id="edit-chapNumber"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editState.number}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, number: "" }));
                        setEditState((s) => s && { ...s, number: e.target.value });
                      }}
                    />
                    {editErrors.number && (
                      <span className="text-caption text-destructive">{editErrors.number}</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 sm:col-span-3">
                    <Label htmlFor="edit-chapTitle">Title *</Label>
                    <Input
                      id="edit-chapTitle"
                      value={editState.title}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, title: "" }));
                        setEditState((s) => s && { ...s, title: e.target.value });
                      }}
                    />
                    {editErrors.title && (
                      <span className="text-caption text-destructive">{editErrors.title}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-baseline">
                    <Label htmlFor="edit-chapContent">Raw Content</Label>
                    {!editState.contentLoading && (
                      <span className="text-caption text-muted-foreground">
                        {editState.rawContent.length.toLocaleString()} characters
                      </span>
                    )}
                  </div>
                  {editState.contentLoading ? (
                    <div className="h-36 rounded-md border border-border bg-muted animate-pulse" />
                  ) : (
                    <Textarea
                      id="edit-chapContent"
                      value={editState.rawContent}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, rawContent: "" }));
                        setEditState((s) => s && { ...s, rawContent: e.target.value });
                      }}
                      rows={10}
                    />
                  )}
                  {editErrors.rawContent && (
                    <span className="text-caption text-destructive">{editErrors.rawContent}</span>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditState(null);
                      setEditErrors({});
                    }}
                    disabled={savingEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={savingEdit || editState.contentLoading}
                  >
                    <Check className="size-4" />
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <hr className="border-border" />

      {/* Add Chapter Form */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Chapter</h2>
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <form onSubmit={handleAddChapter} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                  <Label htmlFor="chapNumber">Number *</Label>
                  <Input
                    id="chapNumber"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 1"
                    value={chapNumber}
                    onChange={(e) => {
                      setFormErrors((err) => ({ ...err, number: "" }));
                      setChapNumber(e.target.value);
                    }}
                    required
                  />
                  {formErrors.number && (
                    <span className="text-caption text-destructive">{formErrors.number}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-3">
                  <Label htmlFor="chapTitle">Title *</Label>
                  <Input
                    id="chapTitle"
                    placeholder="e.g. The Awakening"
                    value={chapTitle}
                    onChange={(e) => {
                      setFormErrors((err) => ({ ...err, title: "" }));
                      setChapTitle(e.target.value);
                    }}
                    required
                  />
                  {formErrors.title && (
                    <span className="text-caption text-destructive">{formErrors.title}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-baseline">
                  <Label htmlFor="chapContent">Raw Content *</Label>
                  <span className="text-caption text-muted-foreground">
                    {chapContent.length.toLocaleString()} characters
                  </span>
                </div>
                <Textarea
                  id="chapContent"
                  placeholder="Paste raw chapter text here..."
                  value={chapContent}
                  onChange={(e) => {
                    setFormErrors((err) => ({ ...err, rawContent: "" }));
                    setChapContent(e.target.value);
                  }}
                  rows={8}
                  required
                />
                {formErrors.rawContent && (
                  <span className="text-caption text-destructive">{formErrors.rawContent}</span>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="submit" disabled={addingChapter}>
                  {addingChapter ? "Adding..." : "Add Chapter"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialogs */}
      <DeleteConfirmDialog
        title="Delete Novel Project"
        description="Are you absolutely sure you want to delete this novel? This action is permanent and will delete all chapters, glossaries, and translation jobs associated with it."
        open={deleteNovelOpen}
        onOpenChange={setDeleteNovelOpen}
        onConfirm={removeNovel}
        pending={deletingNovel}
      />

      <DeleteConfirmDialog
        title="Delete Chapter"
        description="Are you sure you want to delete this chapter? This action is permanent and cannot be undone."
        open={deleteChapterId !== null}
        onOpenChange={(open) => !open && setDeleteChapterId(null)}
        onConfirm={() => deleteChapterId && removeChapter({ chapterId: deleteChapterId })}
        pending={deletingChapter}
      />
    </div>
  );
}
