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
  CheckCheck,
  Sparkles,
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
  previewTermReplacement,
} from "@/lib/glossary.functions";
import {
  createTermSchema,
  updateTermSchema,
  type CreateTermInput,
  type TermCategory,
  type TermStatus,
  type UpdateTermInput,
} from "@/lib/glossary.schemas";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CategoryBadge,
  EDIT_CATEGORY_ITEMS,
  GlossaryTable,
  type EditState,
  type GlossaryTerm,
} from "@/components/glossary/glossary-table";
import { GlossaryDialogs } from "@/components/glossary/glossary-dialogs";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const glossaryTermsQueryOptions = (
  novelId: string,
  search?: string,
  category?: "character" | "place" | "skill" | "item" | "other" | "all",
  status?: "approved" | "pending" | "rejected" | "all",
) =>
  queryOptions({
    queryKey: ["glossaryTerms", novelId, { search, category, status }],
    queryFn: () =>
      listGlossaryTerms({
        data: { novelId, search, category, status },
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
      context.queryClient.ensureQueryData(
        glossaryTermsQueryOptions(params.novelId, "", "all", "approved"),
      ),
      context.queryClient.ensureQueryData(
        glossaryTermsQueryOptions(params.novelId, undefined, undefined, "pending"),
      ),
      context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
    ]);
  },
  component: NovelGlossaryPage,
});

const CATEGORY_ITEMS: Record<string, string> = {
  all: "All Categories",
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

const STATUS_ITEMS: Record<string, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  all: "All Status",
};

function NovelGlossaryPage() {
  const { novelId } = Route.useParams();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "character" | "place" | "skill" | "item" | "other" | "all"
  >("all");
  const [statusFilter, setStatusFilter] = useState<"approved" | "pending" | "rejected" | "all">(
    "approved",
  );

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
  const [replaceConfirm, setReplaceConfirm] = useState<{
    chapterCount: number;
    occurrences: number;
    payload: UpdateTermInput;
  } | null>(null);
  const [previewingReplace, setPreviewingReplace] = useState(false);

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
    mutationFn: (vars: CreateTermInput) => createGlossaryTerm({ data: vars }),
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
    mutationFn: (vars: UpdateTermInput) => updateGlossaryTerm({ data: vars }),
    onSuccess: (_data, vars) => {
      invalidateAll();
      toast.success(
        vars.applyToChapters ? "Term updated and replaced in translated chapters" : "Term updated",
      );
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

    // onError toasts the failure; swallow the rejection so it isn't unhandled.
    await addTerm(payload).catch(() => {});
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

    // Target changed → preview how many translated chapters still use the old
    // target and offer to propagate. Preview failure falls back to a plain save.
    if (editState.target.trim() !== editState.originalTarget) {
      setPreviewingReplace(true);
      try {
        const preview = await previewTermReplacement({
          data: { novelId, oldTarget: editState.originalTarget },
        });
        if (preview.chapterCount > 0) {
          setReplaceConfirm({ ...preview, payload });
          return;
        }
      } catch {
        // fall through to plain save
      } finally {
        setPreviewingReplace(false);
      }
    }

    await saveEdit(payload);
  };

  const confirmReplace = async (apply: boolean) => {
    if (!replaceConfirm) return;
    const { payload } = replaceConfirm;
    setReplaceConfirm(null);
    await saveEdit({ ...payload, applyToChapters: apply });
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
            {(stats?.rejected ?? 0) > 0 && (
              <Badge
                variant="outline"
                className="px-3 py-1 text-xs font-mono text-destructive border-destructive/40 bg-destructive/10"
              >
                Rejected: {stats?.rejected}
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

        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <div className="w-full sm:w-44">
            <Select
              value={categoryFilter}
              onValueChange={(val) => setCategoryFilter(val as TermCategory | "all")}
              items={CATEGORY_ITEMS}
            >
              <SelectTrigger className="w-full">
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

          <div className="w-full sm:w-36">
            <Select
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val as TermStatus | "all")}
              items={STATUS_ITEMS}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
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
          <GlossaryTable
            terms={terms}
            editState={editState}
            setEditState={setEditState}
            editErrors={editErrors}
            setEditErrors={setEditErrors}
            onEdit={(term: GlossaryTerm) =>
              setEditState({
                termId: term.id,
                source: term.source,
                target: term.target,
                category: term.category,
                note: term.note || "",
                originalTarget: term.target,
              })
            }
            onSaveEdit={handleSaveEdit}
            onDelete={setDeleteTermId}
            onApprove={approveTerm}
            savingEdit={savingEdit}
            previewingReplace={previewingReplace}
            approvingTerm={approvingTerm}
          />
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
                  <Select
                    value={newCategory}
                    onValueChange={(val) => setNewCategory(val as TermCategory)}
                    items={EDIT_CATEGORY_ITEMS}
                  >
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

      <GlossaryDialogs
        deleteOpen={deleteTermId !== null}
        onDeleteOpenChange={(open) => !open && setDeleteTermId(null)}
        onDeleteConfirm={() => deleteTermId && removeTerm(deleteTermId)}
        deletingTerm={deletingTerm}
        replaceConfirm={replaceConfirm}
        onReplaceOpenChange={(open) => !open && setReplaceConfirm(null)}
        originalTarget={editState?.originalTarget}
        onReplaceConfirm={confirmReplace}
        savingEdit={savingEdit}
        importOpen={importDialogOpen}
        onImportOpenChange={setImportDialogOpen}
        tsvText={tsvText}
        onTsvTextChange={setTsvText}
        onImport={() => doBulkImport(tsvText)}
        importing={importing}
      />
    </div>
  );
}
