import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Search,
  Upload,
  Check,
  X,
  Edit,
  Trash2,
  CheckCheck,
  Sparkles,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";

import { getNovel } from "@/lib/novel.functions";
import {
  listGlossaryTerms,
  createGlossaryTerm,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  bulkImportGlossaryTerms,
  approveGlossaryTerm,
  approveAllPendingTerms,
  rejectGlossaryTerm,
  getGlossaryStats,
} from "@/lib/glossary.functions";
import { createTermSchema, updateTermSchema } from "@/lib/glossary.schemas";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const glossaryTermsQueryOptions = (
  novelId: string,
  search?: string,
  category?: string,
  status?: string,
) =>
  queryOptions({
    queryKey: ["glossaryTerms", novelId, { search, category, status }],
    queryFn: () =>
      listGlossaryTerms({
        data: { novelId, search, category: category as any, status: status as any },
      }),
  });

const glossaryStatsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["glossaryStats", novelId],
    queryFn: () => getGlossaryStats({ data: { novelId } }),
  });

export const Route = createFileRoute("/_protected/novels/$novelId/glossary")({
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(glossaryTermsQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
    ]);
  },
  component: NovelGlossaryPage,
});

interface EditState {
  termId: string;
  source: string;
  target: string;
  category: "character" | "place" | "skill" | "item" | "other";
  note: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  character: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  place: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  skill: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  item: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

function CategoryBadge({ category }: { category: string }) {
  const colorClass = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  return (
    <Badge variant="outline" className={`capitalize font-medium text-xs ${colorClass}`}>
      {category}
    </Badge>
  );
}

function NovelGlossaryPage() {
  const { novelId } = Route.useParams();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("approved");

  const { data: novel } = useQuery(novelQueryOptions(novelId));
  const { data: stats } = useQuery(glossaryStatsQueryOptions(novelId));
  const { data: terms = [] } = useQuery(
    glossaryTermsQueryOptions(novelId, search, categoryFilter, statusFilter),
  );

  // Pending terms query (always loaded when there are pending terms to power the pending banner)
  const { data: pendingTerms = [] } = useQuery(
    glossaryTermsQueryOptions(novelId, undefined, undefined, "pending"),
  );

  // Edit / Delete states
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [deleteTermId, setDeleteTermId] = useState<string | null>(null);

  // Bulk Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [tsvText, setTsvText] = useState("");

  // Add Term Form state
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newCategory, setNewCategory] = useState<
    "character" | "place" | "skill" | "item" | "other"
  >("character");
  const [newNote, setNewNote] = useState("");
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["glossaryTerms", novelId] });
    queryClient.invalidateQueries({ queryKey: ["glossaryStats", novelId] });
  };

  const { mutateAsync: addTerm, isPending: addingTerm } = useMutation({
    mutationFn: (vars: any) => createGlossaryTerm({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Glossary term added");
      setNewSource("");
      setNewTarget("");
      setNewNote("");
      setAddErrors({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add term");
    },
  });

  const { mutateAsync: saveEdit, isPending: savingEdit } = useMutation({
    mutationFn: (vars: any) => updateGlossaryTerm({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Term updated");
      setEditState(null);
      setEditErrors({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update term");
    },
  });

  const { mutateAsync: removeTerm, isPending: deletingTerm } = useMutation({
    mutationFn: (termId: string) => deleteGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Term deleted");
      setDeleteTermId(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete term");
    },
  });

  const { mutateAsync: approveTerm, isPending: approvingTerm } = useMutation({
    mutationFn: (termId: string) => approveGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Term approved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to approve term");
    },
  });

  const { mutateAsync: approveAll, isPending: approvingAll } = useMutation({
    mutationFn: () => approveAllPendingTerms({ data: { novelId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success("All pending terms approved!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to approve all terms");
    },
  });

  const { mutateAsync: rejectTerm, isPending: rejectingTerm } = useMutation({
    mutationFn: (termId: string) => rejectGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Suggestion rejected");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reject suggestion");
    },
  });

  const { mutateAsync: doBulkImport, isPending: importing } = useMutation({
    mutationFn: (tsv: string) => bulkImportGlossaryTerms({ data: { novelId, tsv } }),
    onSuccess: (res) => {
      invalidateAll();
      toast.success(
        `Imported ${res.imported} new term(s), updated ${res.updated} existing term(s).`,
      );
      if (res.errors.length > 0) {
        toast.warning(`${res.errors.length} line(s) skipped due to format issues.`);
      }
      setImportDialogOpen(false);
      setTsvText("");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to import terms");
    },
  });

  const handleAddSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setAddErrors({});

    const payload = {
      novelId,
      source: newSource,
      target: newTarget,
      category: newCategory,
      note: newNote || undefined,
      status: "approved" as const,
    };

    const result = createTermSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setAddErrors(fieldErrors);
      return;
    }

    await addTerm(payload);
  };

  const handleSaveEdit = async () => {
    if (!editState) return;
    setEditErrors({});

    const payload = {
      termId: editState.termId,
      source: editState.source,
      target: editState.target,
      category: editState.category,
      note: editState.note,
    };

    const result = updateTermSchema.safeParse(payload);
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

    await saveEdit(payload);
  };

  if (!novel) {
    return (
      <div className="text-center py-12">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/novels/$novelId" params={{ novelId }} />}
            aria-label="Back to novel details"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
            <Upload className="size-4" />
            Bulk Import (TSV)
          </Button>
        </div>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
                {novel.title} Glossary
              </h1>
              <Badge
                variant="outline"
                className="uppercase font-semibold text-xs border-foreground/40"
              >
                {novel.sourceLang} → {novel.targetLang}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Maintain consistent names, places, skills, and terminology for translations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1 text-xs font-mono">
              Total: {stats?.total ?? 0}
            </Badge>
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
            >
              Approved: {stats?.approved ?? 0}
            </Badge>
            {(stats?.pending ?? 0) > 0 && (
              <Badge
                variant="outline"
                className="px-3 py-1 text-xs font-mono text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10 animate-pulse"
              >
                Pending: {stats?.pending}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <hr className="border-border" />

      {/* Pending Suggestions Section (v1.1) */}
      {pendingTerms.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10">
          <CardContent className="p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-amber-500" />
                <h2 className="text-card-title font-semibold text-foreground">
                  AI Auto-Suggested Terms ({pendingTerms.length})
                </h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-500/40 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                onClick={() => approveAll()}
                disabled={approvingAll}
              >
                <CheckCheck className="size-4" />
                Approve All ({pendingTerms.length})
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              These terms were extracted automatically from your recent chapter translations.
              Approved terms will be used in future prompt injections.
            </p>

            <div className="rounded-lg border border-amber-500/20 bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Term</TableHead>
                    <TableHead>Target Translation</TableHead>
                    <TableHead className="w-28">Category</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingTerms.map((term) => (
                    <TableRow key={term.id}>
                      <TableCell className="font-semibold text-foreground">{term.source}</TableCell>
                      <TableCell className="font-medium text-foreground">{term.target}</TableCell>
                      <TableCell>
                        <CategoryBadge category={term.category} />
                      </TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {term.note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10"
                            onClick={() => approveTerm(term.id)}
                            disabled={approvingTerm}
                            aria-label="Approve suggestion"
                            title="Approve suggestion"
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10"
                            onClick={() => rejectTerm(term.id)}
                            disabled={rejectingTerm}
                            aria-label="Reject suggestion"
                            title="Reject suggestion"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter & Search Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search source, target, or note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-36">
            <Select value={categoryFilter} onValueChange={(val: any) => setCategoryFilter(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="character">Character</SelectItem>
                <SelectItem value="place">Place</SelectItem>
                <SelectItem value="skill">Skill</SelectItem>
                <SelectItem value="item">Item</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-32">
            <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="all">All Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Main Terms Table */}
      <div className="flex flex-col gap-4">
        {terms.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
            <BookOpen className="size-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {search || categoryFilter !== "all"
                ? "No glossary terms matching your search filter."
                : "No glossary terms defined yet. Add one below or bulk import TSV."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/3">Source Term</TableHead>
                  <TableHead className="w-1/3">Target Translation</TableHead>
                  <TableHead className="w-28">Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((term) => {
                  const isEditing = editState?.termId === term.id;

                  if (isEditing) {
                    return (
                      <TableRow key={term.id} className="bg-muted/40">
                        <TableCell>
                          <Input
                            value={editState.source}
                            onChange={(e) =>
                              setEditState((s) => s && { ...s, source: e.target.value })
                            }
                            placeholder="Source"
                            size={1}
                          />
                          {editErrors.source && (
                            <span className="text-caption text-destructive block mt-1">
                              {editErrors.source}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={editState.target}
                            onChange={(e) =>
                              setEditState((s) => s && { ...s, target: e.target.value })
                            }
                            placeholder="Target"
                            size={1}
                          />
                          {editErrors.target && (
                            <span className="text-caption text-destructive block mt-1">
                              {editErrors.target}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={editState.category}
                            onValueChange={(val: any) =>
                              setEditState((s) => s && { ...s, category: val })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="character">Character</SelectItem>
                              <SelectItem value="place">Place</SelectItem>
                              <SelectItem value="skill">Skill</SelectItem>
                              <SelectItem value="item">Item</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={editState.note}
                            onChange={(e) =>
                              setEditState((s) => s && { ...s, note: e.target.value })
                            }
                            placeholder="Note (optional)"
                            size={1}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-emerald-600 dark:text-emerald-400"
                              onClick={handleSaveEdit}
                              disabled={savingEdit}
                              aria-label="Save edit"
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              onClick={() => {
                                setEditState(null);
                                setEditErrors({});
                              }}
                              aria-label="Cancel edit"
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={term.id}>
                      <TableCell className="font-semibold text-foreground">{term.source}</TableCell>
                      <TableCell className="font-medium text-foreground">{term.target}</TableCell>
                      <TableCell>
                        <CategoryBadge category={term.category} />
                      </TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {term.note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() =>
                              setEditState({
                                termId: term.id,
                                source: term.source,
                                target: term.target,
                                category: term.category as any,
                                note: term.note || "",
                              })
                            }
                            aria-label="Edit term"
                          >
                            <Edit className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setDeleteTermId(term.id)}
                            aria-label="Delete term"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Add Term Form */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Glossary Term</h2>
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="source">Source Term *</Label>
                  <Input
                    id="source"
                    placeholder="e.g. Lin Fan"
                    value={newSource}
                    onChange={(e) => {
                      setAddErrors((err) => ({ ...err, source: "" }));
                      setNewSource(e.target.value);
                    }}
                    required
                  />
                  {addErrors.source && (
                    <span className="text-caption text-destructive">{addErrors.source}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="target">Target Translation *</Label>
                  <Input
                    id="target"
                    placeholder="e.g. หลินฟาน"
                    value={newTarget}
                    onChange={(e) => {
                      setAddErrors((err) => ({ ...err, target: "" }));
                      setNewTarget(e.target.value);
                    }}
                    required
                  />
                  {addErrors.target && (
                    <span className="text-caption text-destructive">{addErrors.target}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="category">Category</Label>
                  <Select value={newCategory} onValueChange={(val: any) => setNewCategory(val)}>
                    <SelectTrigger id="category">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="character">Character</SelectItem>
                      <SelectItem value="place">Place</SelectItem>
                      <SelectItem value="skill">Skill</SelectItem>
                      <SelectItem value="item">Item</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="note">Note (Optional)</Label>
                  <Input
                    id="note"
                    placeholder="e.g. Main protagonist, Sect disciple"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="submit" disabled={addingTerm}>
                  <Plus className="size-4" />
                  {addingTerm ? "Adding..." : "Add Term"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Delete Dialog */}
      <DeleteConfirmDialog
        title="Delete Glossary Term"
        description="Are you sure you want to delete this term? This action cannot be undone."
        open={deleteTermId !== null}
        onOpenChange={(open) => !open && setDeleteTermId(null)}
        onConfirm={() => deleteTermId && removeTerm(deleteTermId)}
        pending={deletingTerm}
      />

      {/* Bulk Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Glossary Terms (TSV)</DialogTitle>
            <DialogDescription>
              Paste tab-separated text containing one term per line. Format: <br />
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">
                source &lt;tab&gt; target &lt;tab&gt; category &lt;tab&gt; note
              </code>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <HelpCircle className="size-3.5" />
              <span>Example TSV format:</span>
            </div>
            <pre className="text-xs bg-muted p-3 rounded-md font-mono text-muted-foreground overflow-x-auto select-all">
              {`Lin Fan\tหลินฟาน\tcharacter\tProtagonist
Sun Peak\tยอดเขาอาทิตย์\tplace\tSect location
Solar Slash\tเพลงดาบสุริยะ\tskill`}
            </pre>

            <Label htmlFor="tsv-input">TSV Content</Label>
            <Textarea
              id="tsv-input"
              rows={8}
              placeholder="Paste TSV data here..."
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setTsvText("");
              }}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button onClick={() => doBulkImport(tsvText)} disabled={importing || !tsvText.trim()}>
              <Upload className="size-4" />
              {importing ? "Importing..." : "Import Terms"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
