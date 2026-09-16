import { useCallback, useState } from "react";

import type {
  GlossaryTermDialogDescriptor,
  GlossaryTermDraft,
  TermReplacementPreview,
} from "@/components/glossary/glossary-term-dialog";
import { useGlossaryMutations } from "@/components/glossary/use-glossary-mutations";
import { previewTermReplacement } from "@/lib/glossary/functions";
import {
  createTermSchema,
  updateTermSchema,
  type GlossaryListRow,
  type UpdateTermInput,
} from "@/lib/glossary/schemas";

type ReplacementState = (TermReplacementPreview & { payload: UpdateTermInput }) | null;

const EMPTY_ADD_DRAFT: GlossaryTermDraft = {
  source: "",
  target: "",
  category: "character",
  note: "",
};

export function useGlossaryPageController(novelId: string) {
  const [termDialog, setTermDialog] = useState<GlossaryTermDialogDescriptor | null>(null);
  const [replacement, setReplacement] = useState<ReplacementState>(null);
  const [previewingReplace, setPreviewingReplace] = useState(false);
  const [deleteTermId, setDeleteTermId] = useState<string | null>(null);
  const [deleteAllTermsOpen, setDeleteAllTermsOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const resetTermDialog = useCallback(() => {
    setTermDialog(null);
    setReplacement(null);
    setPreviewingReplace(false);
  }, []);

  const mutations = useGlossaryMutations(novelId, {
    onAdded: resetTermDialog,
    onSaved: resetTermDialog,
    onDeleted: () => setDeleteTermId(null),
    onAllDeleted: () => setDeleteAllTermsOpen(false),
    onImported: () => setImportDialogOpen(false),
  });

  const openAddDialog = () => {
    setReplacement(null);
    setTermDialog({ mode: "add", initialValues: EMPTY_ADD_DRAFT });
  };

  const openEditDialog = (term: GlossaryListRow) => {
    setReplacement(null);
    setTermDialog({
      mode: "edit",
      termId: term.id,
      originalTarget: term.target,
      initialValues: {
        source: term.source,
        target: term.target,
        category: term.category,
        note: term.note ?? "",
      },
    });
  };

  const handleTermDialogChange = (open: boolean) => {
    if (!open && !mutations.addingTerm && !mutations.savingEdit && !previewingReplace) {
      resetTermDialog();
    }
  };

  const submitTerm = async (draft: GlossaryTermDraft) => {
    if (!termDialog) return;
    if (termDialog.mode === "add") {
      const payload = createTermSchema.parse({
        novelId,
        ...draft,
        note: draft.note || undefined,
        status: "approved",
      });
      await mutations.addTerm(payload).catch(() => {});
      return;
    }

    const payload = updateTermSchema.parse({
      termId: termDialog.termId,
      ...draft,
    });
    if (draft.target.trim() !== termDialog.originalTarget) {
      setPreviewingReplace(true);
      try {
        const preview = await previewTermReplacement({
          data: { novelId, oldTarget: termDialog.originalTarget },
        });
        if (preview.chapterCount > 0) {
          setReplacement({ ...preview, payload });
          return;
        }
      } catch {
        // A failed preview falls back to saving the glossary entry only.
      } finally {
        setPreviewingReplace(false);
      }
    }

    await mutations.saveEdit(payload).catch(() => {});
  };

  const confirmReplacement = async (applyToChapters: boolean) => {
    if (!replacement) return;
    const payload = replacement.payload;
    setReplacement(null);
    await mutations.saveEdit({ ...payload, applyToChapters }).catch(() => {});
  };

  return {
    ...mutations,
    confirmReplacement,
    clearReplacement: () => setReplacement(null),
    deleteAllTermsOpen,
    deleteTermId,
    handleTermDialogChange,
    importDialogOpen,
    openAddDialog,
    openEditDialog,
    previewingReplace,
    replacement,
    setDeleteAllTermsOpen,
    setDeleteTermId,
    setImportDialogOpen,
    submitTerm,
    termDialog,
  };
}
