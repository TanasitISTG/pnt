import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen } from "lucide-react";

import { getNovel } from "@/lib/novel.functions";
import {
  listGlossaryTerms,
  getGlossaryStats,
  previewTermReplacement,
} from "@/lib/glossary.functions";
import { createTermSchema, updateTermSchema, type UpdateTermInput } from "@/lib/glossary.schemas";

import { Button } from "@/components/ui/button";
import {
  GlossaryTable,
  type EditState,
  type GlossaryTerm,
} from "@/components/glossary/glossary-table";
import { GlossaryDialogs } from "@/components/glossary/glossary-dialogs";
import { GlossaryHeader } from "@/components/glossary/glossary-header";
import { PendingTermsCard } from "@/components/glossary/pending-terms-card";
import { GlossaryFilters } from "@/components/glossary/glossary-filters";
import { AddTermForm } from "@/components/glossary/add-term-form";
import { useGlossaryMutations } from "@/components/glossary/use-glossary-mutations";

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

function NovelGlossaryPage() {
  const { novelId } = Route.useParams();

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

  const {
    addTerm,
    addingTerm,
    saveEdit,
    savingEdit,
    removeTerm,
    deletingTerm,
    approveTerm,
    approvingTerm,
    approveAll,
    approvingAll,
    rejectTerm,
    rejectingTerm,
    doBulkImport,
    importing,
  } = useGlossaryMutations(novelId, {
    onAdded: () => {
      setNewSource("");
      setNewTarget("");
      setNewNote("");
      setAddErrors({});
    },
    onSaved: () => {
      setEditState(null);
      setEditErrors({});
    },
    onDeleted: () => setDeleteTermId(null),
    onImported: () => {
      setImportDialogOpen(false);
      setTsvText("");
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
      <GlossaryHeader
        novelId={novelId}
        title={novel.title}
        sourceLang={novel.sourceLang}
        targetLang={novel.targetLang}
        stats={stats}
        onImportClick={() => setImportDialogOpen(true)}
      />

      <hr className="border-border" />

      {/* Pending Suggestions Section (v1.1) */}
      <PendingTermsCard
        terms={pendingTerms}
        approvingAll={approvingAll}
        approvingTerm={approvingTerm}
        rejectingTerm={rejectingTerm}
        onApproveAll={() => approveAll()}
        onApprove={approveTerm}
        onReject={rejectTerm}
      />

      {/* Filter & Search Controls */}
      <GlossaryFilters
        search={search}
        onSearchChange={setSearch}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

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
      <AddTermForm
        newSource={newSource}
        setNewSource={setNewSource}
        newTarget={newTarget}
        setNewTarget={setNewTarget}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        newNote={newNote}
        setNewNote={setNewNote}
        addErrors={addErrors}
        setAddErrors={setAddErrors}
        addingTerm={addingTerm}
        onSubmit={handleAddSubmit}
      />

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
