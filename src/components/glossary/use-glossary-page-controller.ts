import { useCallback, useState, type FormEvent } from "react";

import { previewTermReplacement } from "@/lib/glossary/functions";
import { createTermSchema, updateTermSchema, type UpdateTermInput } from "@/lib/glossary/schemas";
import { useGlossaryMutations } from "@/components/glossary/use-glossary-mutations";
import type {
  GlossaryEditState,
  GlossaryTermDraft,
  TermReplacementPreview,
} from "@/components/glossary/glossary-term-dialog";
import type { GlossaryListRow } from "@/lib/glossary/schemas";

type ReplacementState = (TermReplacementPreview & { payload: UpdateTermInput }) | null;

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

export function useGlossaryPageController(novelId: string) {
  const [termDialogMode, setTermDialogMode] = useState<"add" | "edit" | null>(null);
  const [addDraft, setAddDraft] = useState<GlossaryTermDraft>(EMPTY_ADD_DRAFT);
  const [editState, setEditState] = useState<GlossaryEditState | null>(null);
  const [termErrors, setTermErrors] = useState<Record<string, string>>({});
  const [replacement, setReplacement] = useState<ReplacementState>(null);
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

  const mutations = useGlossaryMutations(novelId, {
    onAdded: resetTermDialog,
    onSaved: resetTermDialog,
    onDeleted: () => setDeleteTermId(null),
    onAllDeleted: () => setDeleteAllTermsOpen(false),
    onImported: () => {
      setImportDialogOpen(false);
      setTsvText("");
    },
  });

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
    if (!open && !mutations.addingTerm && !mutations.savingEdit && !previewingReplace) {
      resetTermDialog();
    }
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
    await mutations.addTerm(payload).catch(() => {});
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

    await mutations.saveEdit(parsed.data).catch(() => {});
  };

  const confirmReplacement = async (applyToChapters: boolean) => {
    if (!replacement) return;
    const payload = replacement.payload;
    setReplacement(null);
    await mutations.saveEdit({ ...payload, applyToChapters }).catch(() => {});
  };
  const clearReplacement = () => setReplacement(null);

  return {
    ...mutations,
    addDraft,
    confirmReplacement,
    clearReplacement,
    deleteAllTermsOpen,
    deleteTermId,
    editState,
    handleAddSubmit,
    handleSaveEdit,
    handleTermDialogChange,
    importDialogOpen,
    openAddDialog,
    openEditDialog,
    previewingReplace,
    replacement,
    setAddDraft,
    setDeleteAllTermsOpen,
    setDeleteTermId,
    setEditState,
    setImportDialogOpen,
    setTsvText,
    termDialogMode,
    termErrors,
    tsvText,
  };
}
