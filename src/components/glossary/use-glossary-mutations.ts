import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  const { onAdded, onSaved, onDeleted, onImported, onAllDeleted } = callbacks;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["glossaryTerms", novelId] });
    queryClient.invalidateQueries({ queryKey: ["glossaryStats", novelId] });
  };

  const { mutateAsync: addTerm, isPending: addingTerm } = useMutation({
    mutationFn: (vars: CreateTermInput) => createGlossaryTerm({ data: vars }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Glossary term added");
      onAdded();
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
      onSaved();
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
      onDeleted();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete term");
    },
  });

  const { mutateAsync: deleteAllTerms, isPending: deletingAllTerms } = useMutation({
    mutationFn: () => deleteAllGlossaryTerms({ data: { novelId } }),
    onSuccess: ({ deleted }) => {
      invalidateAll();
      toast.success(`Deleted ${deleted} glossary term(s)`);
      onAllDeleted();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete all terms");
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

  const { mutateAsync: rejectAll, isPending: rejectingAll } = useMutation({
    mutationFn: () => rejectAllPendingTerms({ data: { novelId } }),
    onSuccess: ({ rejected }) => {
      invalidateAll();
      toast.success(`Rejected ${rejected} suggestion(s)`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reject all suggestions");
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
      onImported();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to import terms");
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
