import { getRouteApi, Link } from "@tanstack/react-router";
import { useCallback, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { GlossaryDialogs } from "@/components/glossary/glossary-dialogs";
import { GlossaryHeader } from "@/components/glossary/glossary-header";
import {
  GlossaryTermDialog,
  type GlossaryEditState,
  type GlossaryTermDraft,
  type TermReplacementPreview,
} from "@/components/glossary/glossary-term-dialog";
import { GlossaryTable } from "@/components/glossary/glossary-table";
import { useGlossaryMutations } from "@/components/glossary/use-glossary-mutations";
import {
  glossaryNovelQueryOptions,
  glossaryStatsQueryOptions,
  glossaryTermsQueryOptions,
} from "@/lib/glossary/query";
import {
  createTermSchema,
  updateTermSchema,
  type GlossaryListRow,
  type TermCategory,
  type UpdateTermInput,
} from "@/lib/glossary/schemas";
import { previewTermReplacement } from "@/lib/glossary/functions";
import { useQuery } from "@tanstack/react-query";

const glossaryRoute = getRouteApi("/_protected/novels/$novelId/glossary");

const EMPTY_ADD_DRAFT: GlossaryTermDraft = {
  source: "",
  target: "",
  category: "character",
  note: "",
};

function toFieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field !== undefined && fieldErrors[String(field)] === undefined) {
      fieldErrors[String(field)] = issue.message;
    }
  }
  return fieldErrors;
}

export function GlossaryPage() {
  const { novelId } = glossaryRoute.useParams();
  const search = glossaryRoute.useSearch();
  const navigate = glossaryRoute.useNavigate();
  const novelQuery = useQuery(glossaryNovelQueryOptions(novelId));
  const statsQuery = useQuery(glossaryStatsQueryOptions(novelId));
  const termsQuery = useQuery(glossaryTermsQueryOptions(novelId, search));

  const [termDialogMode, setTermDialogMode] = useState<"add" | "edit" | null>(null);
  const [addDraft, setAddDraft] = useState<GlossaryTermDraft>(EMPTY_ADD_DRAFT);
  const [editState, setEditState] = useState<GlossaryEditState | null>(null);
  const [termErrors, setTermErrors] = useState<Record<string, string>>({});
  const [replacement, setReplacement] = useState<
    (TermReplacementPreview & { payload: UpdateTermInput }) | null
  >(null);
  const [previewingReplace, setPreviewingReplace] = useState(false);
  const [deleteTermId, setDeleteTermId] = useState<string | null>(null);
  const [deleteAllTermsOpen, setDeleteAllTermsOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [tsvText, setTsvText] = useState("");

  const resetTermDialog = useCallback(() => {
    setTermDialogMode(null);
    setAddDraft(EMPTY_ADD_DRAFT);
    setEditState(null);
    setTermErrors({});
    setReplacement(null);
    setPreviewingReplace(false);
  }, []);

  const {
    addTerm,
    addingTerm,
    saveEdit,
    savingEdit,
    removeTerm,
    deletingTerm,
    deleteAllTerms,
    deletingAllTerms,
    approveTerm,
    approvingTerm,
    approveAll,
    approvingAll,
    rejectTerm,
    rejectingTerm,
    rejectAll,
    rejectingAll,
    doBulkImport,
    importing,
  } = useGlossaryMutations(novelId, {
    onAdded: resetTermDialog,
    onSaved: resetTermDialog,
    onDeleted: () => setDeleteTermId(null),
    onAllDeleted: () => setDeleteAllTermsOpen(false),
    onImported: () => {
      setImportDialogOpen(false);
      setTsvText("");
    },
  });

  const updateSearch = useCallback(
    (changes: Partial<typeof search>, replace = true) => {
      navigate({
        search: (previous) => ({ ...previous, ...changes }),
        replace,
      });
    },
    [navigate],
  );

  const openAddDialog = () => {
    setTermErrors({});
    setReplacement(null);
    setAddDraft(EMPTY_ADD_DRAFT);
    setTermDialogMode("add");
  };

  const openEditDialog = (term: GlossaryListRow) => {
    setTermErrors({});
    setReplacement(null);
    setEditState({
      termId: term.id,
      source: term.source,
      target: term.target,
      category: term.category,
      note: term.note ?? "",
      originalTarget: term.target,
    });
    setTermDialogMode("edit");
  };

  const handleTermDialogChange = (open: boolean) => {
    if (!open && !addingTerm && !savingEdit && !previewingReplace) resetTermDialog();
  };

  const handleAddSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTermErrors({});
    const payload = {
      novelId,
      source: addDraft.source,
      target: addDraft.target,
      category: addDraft.category,
      note: addDraft.note || undefined,
      status: "approved" as const,
    };
    const parsed = createTermSchema.safeParse(payload);
    if (!parsed.success) {
      setTermErrors(toFieldErrors(parsed.error));
      return;
    }
    await addTerm(payload).catch(() => {});
  };

  const handleSaveEdit = async () => {
    if (!editState) return;
    setTermErrors({});
    const payload = {
      termId: editState.termId,
      source: editState.source,
      target: editState.target,
      category: editState.category,
      note: editState.note,
    };
    const parsed = updateTermSchema.safeParse(payload);
    if (!parsed.success) {
      setTermErrors(toFieldErrors(parsed.error));
      return;
    }

    if (editState.target.trim() !== editState.originalTarget) {
      setPreviewingReplace(true);
      try {
        const preview = await previewTermReplacement({
          data: { novelId, oldTarget: editState.originalTarget },
        });
        if (preview.chapterCount > 0) {
          setReplacement({ ...preview, payload: parsed.data });
          return;
        }
      } catch {
        // A failed preview falls back to saving the glossary entry only.
      } finally {
        setPreviewingReplace(false);
      }
    }

    await saveEdit(parsed.data).catch(() => {});
  };

  const confirmReplacement = async (applyToChapters: boolean) => {
    if (!replacement) return;
    const payload = replacement.payload;
    setReplacement(null);
    await saveEdit({ ...payload, applyToChapters }).catch(() => {});
  };

  const stats = statsQuery.data;
  const pendingCount = stats?.pending ?? 0;
  const isViewingPending = search.status === "pending";
  const hasPendingActions =
    approvingAll || rejectingAll || approvingTerm || rejectingTerm || deletingTerm;
  const novel = novelQuery.data;

  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <GlossaryHeader
        novelId={novelId}
        title={novel.title}
        sourceLang={novel.sourceLang}
        targetLang={novel.targetLang}
        stats={stats}
        onAddClick={openAddDialog}
        onImportClick={() => setImportDialogOpen(true)}
        deletingAllTerms={deletingAllTerms}
        onDeleteAllTerms={() => setDeleteAllTermsOpen(true)}
      />

      {pendingCount > 0 && !isViewingPending && (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-foreground">
              {pendingCount.toLocaleString()} AI suggestions awaiting review
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              Review extracted mappings before they influence future translations.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-500/40"
            onClick={() =>
              updateSearch(
                {
                  q: "",
                  category: "all",
                  status: "pending",
                  sort: "source",
                  dir: "asc",
                  page: 1,
                },
                true,
              )
            }
          >
            Review suggestions
          </Button>
        </section>
      )}

      {isViewingPending && pendingCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="font-medium text-foreground">Pending suggestions</p>
            <p className="mt-1 text-caption text-muted-foreground">
              Bulk actions apply to all {pendingCount.toLocaleString()} pending terms in this novel.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void approveAll().catch(() => {})}
              disabled={hasPendingActions}
            >
              {approvingAll ? "Approving…" : `Approve all ${pendingCount} pending`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => void rejectAll().catch(() => {})}
              disabled={hasPendingActions}
            >
              {rejectingAll ? "Rejecting…" : `Reject all ${pendingCount} pending`}
            </Button>
          </div>
        </div>
      )}

      <GlossaryTable
        query={{
          page: termsQuery.data,
          isPending: termsQuery.isPending,
          isFetching: termsQuery.isFetching,
          isPlaceholderData: termsQuery.isPlaceholderData,
          isError: termsQuery.isError,
          error: termsQuery.error,
        }}
        search={search}
        onRetry={() => void termsQuery.refetch()}
        onSearchChange={updateSearch}
        actions={{
          onEdit: openEditDialog,
          onDelete: setDeleteTermId,
          onApprove: (termId) => void approveTerm(termId).catch(() => {}),
          onReject: (termId) => void rejectTerm(termId).catch(() => {}),
          pending: hasPendingActions || savingEdit || addingTerm || importing,
        }}
      />

      <GlossaryTermDialog
        mode={termDialogMode}
        open={termDialogMode !== null}
        onOpenChange={handleTermDialogChange}
        addDraft={addDraft}
        onAddDraftChange={setAddDraft}
        editState={editState}
        onEditStateChange={setEditState}
        errors={termErrors}
        onSubmit={(event) => {
          if (termDialogMode === "edit") {
            event.preventDefault();
            void handleSaveEdit();
          } else {
            void handleAddSubmit(event);
          }
        }}
        addingTerm={addingTerm}
        savingEdit={savingEdit}
        previewingReplace={previewingReplace}
        replacement={replacement}
        onBackFromReplacement={() => setReplacement(null)}
        onReplaceConfirm={confirmReplacement}
      />

      <GlossaryDialogs
        deleteOpen={deleteTermId !== null}
        onDeleteOpenChange={(open) => !open && setDeleteTermId(null)}
        onDeleteConfirm={() => deleteTermId && void removeTerm(deleteTermId).catch(() => {})}
        deletingTerm={deletingTerm}
        deleteAllOpen={deleteAllTermsOpen}
        onDeleteAllOpenChange={setDeleteAllTermsOpen}
        onDeleteAllConfirm={() => void deleteAllTerms().catch(() => {})}
        deletingAllTerms={deletingAllTerms}
        importOpen={importDialogOpen}
        onImportOpenChange={setImportDialogOpen}
        tsvText={tsvText}
        onTsvTextChange={setTsvText}
        onImport={() => void doBulkImport(tsvText).catch(() => {})}
        importing={importing}
      />
    </div>
  );
}

export type { GlossaryTermDraft, GlossaryEditState, TermCategory };
