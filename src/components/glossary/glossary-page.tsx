import { getRouteApi, Link } from "@tanstack/react-router";
import { useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GlossaryDialogs } from "@/components/glossary/glossary-dialogs";
import { GlossaryHeader } from "@/components/glossary/glossary-header";
import { GlossaryTermDialog } from "@/components/glossary/glossary-term-dialog";
import { GlossaryTable } from "@/components/glossary/glossary-table";
import { useGlossaryPageController } from "@/components/glossary/use-glossary-page-controller";
import {
  glossaryNovelQueryOptions,
  glossaryStatsQueryOptions,
  glossaryTermsQueryOptions,
} from "@/lib/glossary/query";
import type { GlossaryListSearch } from "@/lib/glossary/schemas";

const glossaryRoute = getRouteApi("/_protected/novels/$novelId/glossary");
function GlossaryNotFound() {
  return (
    <div className="py-12 text-center">
      <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
      <Button className="mt-4" render={<Link to="/" />}>
        Back to Library
      </Button>
    </div>
  );
}

function PendingSuggestionsNotice({
  pendingCount,
  isViewingPending,
  onReview,
}: {
  pendingCount: number;
  isViewingPending: boolean;
  onReview: () => void;
}) {
  if (pendingCount === 0 || isViewingPending) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-foreground">
          {pendingCount.toLocaleString()} AI suggestions awaiting review
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          Review extracted mappings before they influence future translations.
        </p>
      </div>
      <Button variant="outline" size="sm" className="border-amber-500/40" onClick={onReview}>
        Review suggestions
      </Button>
    </section>
  );
}

interface PendingBulkActionsProps {
  pendingCount: number;
  isViewingPending: boolean;
  hasPendingActions: boolean;
  approvingAll: boolean;
  rejectingAll: boolean;
  onApproveAll: () => void;
  onRejectAll: () => void;
}

function PendingBulkActions({
  pendingCount,
  isViewingPending,
  hasPendingActions,
  approvingAll,
  rejectingAll,
  onApproveAll,
  onRejectAll,
}: PendingBulkActionsProps) {
  if (!isViewingPending || pendingCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="font-medium text-foreground">Pending suggestions</p>
        <p className="mt-1 text-caption text-muted-foreground">
          Bulk actions apply to all {pendingCount.toLocaleString()} pending terms in this novel.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onApproveAll} disabled={hasPendingActions}>
          {approvingAll ? "Approving…" : `Approve all ${pendingCount} pending`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={onRejectAll}
          disabled={hasPendingActions}
        >
          {rejectingAll ? "Rejecting…" : `Reject all ${pendingCount} pending`}
        </Button>
      </div>
    </div>
  );
}

const PENDING_SEARCH: Partial<GlossaryListSearch> = {
  q: "",
  category: "all",
  status: "pending",
  sort: "source",
  dir: "asc",
  page: 1,
};

export function GlossaryPage() {
  const { novelId } = glossaryRoute.useParams();
  const search = glossaryRoute.useSearch();
  const navigate = glossaryRoute.useNavigate();
  const novelQuery = useQuery(glossaryNovelQueryOptions(novelId));
  const statsQuery = useQuery(glossaryStatsQueryOptions(novelId));
  const termsQuery = useQuery(glossaryTermsQueryOptions(novelId, search));
  const {
    addDraft,
    addingTerm,
    approveAll,
    approvingAll,
    approveTerm,
    approvingTerm,
    clearReplacement,
    confirmReplacement,
    deleteAllTerms,
    deleteAllTermsOpen,
    deleteTermId,
    deletingAllTerms,
    deletingTerm,
    doBulkImport,
    editState,
    handleAddSubmit,
    handleSaveEdit,
    handleTermDialogChange,
    importDialogOpen,
    importing,
    openAddDialog,
    openEditDialog,
    previewingReplace,
    rejectAll,
    rejectingAll,
    rejectingTerm,
    rejectTerm,
    removeTerm,
    replacement,
    savingEdit,
    setAddDraft,
    setDeleteAllTermsOpen,
    setDeleteTermId,
    setEditState,
    setImportDialogOpen,
    setTsvText,
    termDialogMode,
    termErrors,
    tsvText,
  } = useGlossaryPageController(novelId);

  const updateSearch = useCallback(
    (changes: Partial<typeof search>, replace = true) => {
      navigate({
        search: (previous) => ({ ...previous, ...changes }),
        replace,
      });
    },
    [navigate],
  );

  const stats = statsQuery.data;
  const pendingCount = stats?.pending ?? 0;
  const isViewingPending = search.status === "pending";
  const hasPendingActions =
    approvingAll || rejectingAll || approvingTerm || rejectingTerm || deletingTerm;
  const novel = novelQuery.data;

  if (!novel) return <GlossaryNotFound />;

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

      <PendingSuggestionsNotice
        pendingCount={pendingCount}
        isViewingPending={isViewingPending}
        onReview={() => updateSearch(PENDING_SEARCH, true)}
      />
      <PendingBulkActions
        pendingCount={pendingCount}
        isViewingPending={isViewingPending}
        hasPendingActions={hasPendingActions}
        approvingAll={approvingAll}
        rejectingAll={rejectingAll}
        onApproveAll={() => void approveAll().catch(() => {})}
        onRejectAll={() => void rejectAll().catch(() => {})}
      />

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
        onBackFromReplacement={clearReplacement}
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
