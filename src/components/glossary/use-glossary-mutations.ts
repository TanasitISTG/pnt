import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import {
  createGlossaryTerm,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  deleteAllGlossaryTerms,
  bulkImportGlossaryTerms,
  approveGlossaryTerm,
  approveAllPendingTerms,
  rejectGlossaryTerm,
  rejectAllPendingTerms,
} from "@/lib/glossary/functions";
import type { CreateTermInput, UpdateTermInput } from "@/lib/glossary/schemas";
import { invalidateNovelChapterDetails } from "@/lib/content/chapter/chapter.query";

export interface GlossaryMutationCallbacks {
  /** Reset the add-term form after a successful create. */
  onAdded: () => void;
  /** Close the edit row after a successful save. */
  onSaved: () => void;
  /** Close the delete dialog after a successful delete. */
  onDeleted: () => void;
  /** Close the import dialog after a successful import. */
  onImported: () => void;
  /** Close the delete-all dialog after a successful delete. */
  onAllDeleted: () => void;
}

export function useGlossaryMutations(novelId: string, callbacks: GlossaryMutationCallbacks) {
  const t = useTranslations("studio");
  const queryClient = useQueryClient();
  const { onAdded, onSaved, onDeleted, onImported, onAllDeleted } = callbacks;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["glossaryTerms", novelId] });
    queryClient.invalidateQueries({ queryKey: ["glossaryStats", novelId] });
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
    void invalidateNovelChapterDetails(queryClient, novelId);
    queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", novelId] });
  };

  const { mutateAsync: addTerm, isPending: addingTerm } = useMutation({
    mutationFn: (vars: CreateTermInput) => createGlossaryTerm({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("glossaryTermAdded"));
      onAdded();
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermAddFailed"));
    },
  });

  const { mutateAsync: saveEdit, isPending: savingEdit } = useMutation({
    mutationFn: (vars: UpdateTermInput) => updateGlossaryTerm({ data: vars }),
    onSuccess: (_data, vars) => {
      invalidateAll();
      toast.success(
        vars.applyToChapters ? t("glossaryTermUpdatedReplaced") : t("glossaryTermUpdated"),
      );
      onSaved();
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermUpdateFailed"));
    },
  });

  const { mutateAsync: removeTerm, isPending: deletingTerm } = useMutation({
    mutationFn: (termId: string) => deleteGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("glossaryTermDeleted"));
      onDeleted();
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermDeleteFailed"));
    },
  });

  const { mutateAsync: deleteAllTerms, isPending: deletingAllTerms } = useMutation({
    mutationFn: () => deleteAllGlossaryTerms({ data: { novelId } }),
    onSuccess: ({ deleted }) => {
      invalidateAll();
      toast.success(t("glossaryTermsDeleted", { count: deleted }));
      onAllDeleted();
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermsClearFailed"));
    },
  });

  const { mutateAsync: approveTerm, isPending: approvingTerm } = useMutation({
    mutationFn: (termId: string) => approveGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("glossaryTermApproved"));
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermApproveFailed"));
    },
  });

  const { mutateAsync: approveAll, isPending: approvingAll } = useMutation({
    mutationFn: () => approveAllPendingTerms({ data: { novelId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("glossaryAllApproved"));
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryApproveAllFailed"));
    },
  });

  const { mutateAsync: rejectAll, isPending: rejectingAll } = useMutation({
    mutationFn: () => rejectAllPendingTerms({ data: { novelId } }),
    onSuccess: ({ rejected }) => {
      invalidateAll();
      toast.success(t("glossarySuggestionsRejected", { count: rejected }));
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryRejectAllFailed"));
    },
  });

  const { mutateAsync: rejectTerm, isPending: rejectingTerm } = useMutation({
    mutationFn: (termId: string) => rejectGlossaryTerm({ data: { termId } }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t("glossaryTermRejected"));
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryTermRejectFailed"));
    },
  });

  const { mutateAsync: doBulkImport, isPending: importing } = useMutation({
    mutationFn: (tsv: string) => bulkImportGlossaryTerms({ data: { novelId, tsv } }),
    onSuccess: (res) => {
      invalidateAll();
      toast.success(t("glossaryImported", { imported: res.imported, updated: res.updated }));
      if (res.errors.length > 0) {
        toast.warning(t("glossaryImportSkipped", { count: res.errors.length }));
      }
      onImported();
    },
    onError: (error) => {
      toast.error(error.message || t("glossaryImportFailed"));
    },
  });

  return {
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
  };
}
