import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import type { CharacterFormState, RelationshipFormState } from "./relationship-entry-form";
import {
  EMPTY_CHARACTER_FORM,
  EMPTY_RELATIONSHIP_FORM,
  splitAliases,
  toFieldErrors,
} from "./relationship-entry-form";
import type { RelationshipTableActions } from "./relationship-map-table";
import {
  deleteRelationshipEntry,
  setRelationshipEntryAutoManaged,
  setRelationshipEntryEnabled,
  upsertCharacterProfile,
  upsertCharacterRelationship,
} from "@/lib/relationships/functions";
import {
  deleteRelationshipEntrySchema,
  setRelationshipEntryAutoManagedSchema,
  setRelationshipEntryEnabledSchema,
  upsertCharacterProfileSchema,
  upsertCharacterRelationshipSchema,
  type CharacterProfile,
  type CharacterRelationship,
} from "@/lib/relationships/schemas";

type DeleteTarget = {
  entryType: "character" | "relationship";
  entryId: string;
  label: string;
};

export function useRelationshipsPageController(novelId: string) {
  const queryClient = useQueryClient();
  const [characterForm, setCharacterForm] = useState<CharacterFormState | null>(null);
  const [relationshipForm, setRelationshipForm] = useState<RelationshipFormState | null>(null);
  const [characterErrors, setCharacterErrors] = useState<Record<string, string>>({});
  const [relationshipErrors, setRelationshipErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const invalidateMap = () => {
    void queryClient.invalidateQueries({ queryKey: ["relationshipMap", novelId] });
  };

  const saveCharacter = useMutation({
    mutationFn: (payload: z.infer<typeof upsertCharacterProfileSchema>) =>
      upsertCharacterProfile({ data: payload }),
    onSuccess: () => {
      invalidateMap();
      toast.success("Character profile saved");
      setCharacterForm(null);
      setCharacterErrors({});
    },
    onError: (error) => toast.error(error.message || "Failed to save character profile"),
  });

  const saveRelationship = useMutation({
    mutationFn: (payload: z.infer<typeof upsertCharacterRelationshipSchema>) =>
      upsertCharacterRelationship({ data: payload }),
    onSuccess: () => {
      invalidateMap();
      toast.success("Directed relationship saved");
      setRelationshipForm(null);
      setRelationshipErrors({});
    },
    onError: (error) => toast.error(error.message || "Failed to save directed relationship"),
  });

  const toggleEntry = useMutation({
    mutationFn: (payload: z.infer<typeof setRelationshipEntryEnabledSchema>) =>
      setRelationshipEntryEnabled({ data: payload }),
    onSuccess: (_data, variables) => {
      invalidateMap();
      toast.success(
        variables.enabled ? "Relationship entry restored" : "Relationship entry disabled",
      );
    },
    onError: (error) => toast.error(error.message || "Failed to update relationship entry"),
  });

  const useAutoUpdates = useMutation({
    mutationFn: (payload: z.infer<typeof setRelationshipEntryAutoManagedSchema>) =>
      setRelationshipEntryAutoManaged({ data: payload }),
    onSuccess: () => {
      invalidateMap();
      toast.success("Automatic updates enabled");
    },
    onError: (error) => toast.error(error.message || "Failed to enable automatic updates"),
  });

  const removeEntry = useMutation({
    mutationFn: (payload: z.infer<typeof deleteRelationshipEntrySchema>) =>
      deleteRelationshipEntry({ data: payload }),
    onSuccess: () => {
      invalidateMap();
      toast.success("Relationship entry deleted");
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message || "Failed to delete relationship entry"),
  });

  const openCharacterAdd = () => {
    setCharacterErrors({});
    setCharacterForm({ ...EMPTY_CHARACTER_FORM });
  };
  const openRelationshipAdd = () => {
    setRelationshipErrors({});
    setRelationshipForm({ ...EMPTY_RELATIONSHIP_FORM });
  };
  const openCharacterEdit = (character: CharacterProfile) => {
    setCharacterErrors({});
    setCharacterForm({
      id: character.id,
      sourceName: character.sourceName,
      targetName: character.targetName ?? "",
      aliases: character.aliases.join(", "),
      gender: character.gender,
      role: character.role ?? "",
      notes: character.notes ?? "",
      evidence: character.evidence ?? "",
    });
  };
  const openRelationshipEdit = (relationship: CharacterRelationship) => {
    setRelationshipErrors({});
    setRelationshipForm({
      id: relationship.id,
      speakerId: relationship.speakerId,
      listenerId: relationship.listenerId,
      relationship: relationship.relationship,
      speakerStatus: relationship.speakerStatus,
      familiarity: relationship.familiarity,
      selfPronoun: relationship.selfPronoun ?? "",
      addresseeTerm: relationship.addresseeTerm ?? "",
      sentenceParticles: relationship.sentenceParticles ?? "",
      register: relationship.register ?? "",
      notes: relationship.notes ?? "",
      evidence: relationship.evidence ?? "",
    });
  };
  const closeCharacterDialog = (open: boolean) => {
    if (!open && !saveCharacter.isPending) {
      setCharacterForm(null);
      setCharacterErrors({});
    }
  };
  const closeRelationshipDialog = (open: boolean) => {
    if (!open && !saveRelationship.isPending) {
      setRelationshipForm(null);
      setRelationshipErrors({});
    }
  };

  const submitCharacter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!characterForm) return;
    setCharacterErrors({});
    const parsed = upsertCharacterProfileSchema.safeParse({
      novelId,
      id: characterForm.id,
      sourceName: characterForm.sourceName,
      targetName: characterForm.targetName.trim() || null,
      aliases: splitAliases(characterForm.aliases),
      gender: characterForm.gender,
      role: characterForm.role.trim() || null,
      notes: characterForm.notes.trim() || null,
      evidence: characterForm.evidence.trim() || null,
    });
    if (!parsed.success) {
      setCharacterErrors(toFieldErrors(parsed.error));
      return;
    }
    void saveCharacter.mutateAsync(parsed.data).catch(() => {});
  };

  const submitRelationship = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!relationshipForm) return;
    setRelationshipErrors({});
    const parsed = upsertCharacterRelationshipSchema.safeParse({
      novelId,
      id: relationshipForm.id,
      speakerId: relationshipForm.speakerId,
      listenerId: relationshipForm.listenerId,
      relationship: relationshipForm.relationship,
      speakerStatus: relationshipForm.speakerStatus,
      familiarity: relationshipForm.familiarity,
      selfPronoun: relationshipForm.selfPronoun.trim() || null,
      addresseeTerm: relationshipForm.addresseeTerm.trim() || null,
      sentenceParticles: relationshipForm.sentenceParticles.trim() || null,
      register: relationshipForm.register.trim() || null,
      notes: relationshipForm.notes.trim() || null,
      evidence: relationshipForm.evidence.trim() || null,
    });
    if (!parsed.success) {
      setRelationshipErrors(toFieldErrors(parsed.error));
      return;
    }
    void saveRelationship.mutateAsync(parsed.data).catch(() => {});
  };

  const requestDelete = (entryType: DeleteTarget["entryType"], entryId: string, label: string) =>
    setDeleteTarget({ entryType, entryId, label });
  const closeDeleteDialog = (open: boolean) => {
    if (!open) setDeleteTarget(null);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    removeEntry.mutate({
      novelId,
      entryType: deleteTarget.entryType,
      entryId: deleteTarget.entryId,
    });
  };

  const actions: RelationshipTableActions = {
    onEditCharacter: openCharacterEdit,
    onEditRelationship: openRelationshipEdit,
    onToggle: (entryType, entryId, enabled) =>
      toggleEntry.mutate({ novelId, entryType, entryId, enabled }),
    onAuto: (entryType, entryId) => useAutoUpdates.mutate({ novelId, entryType, entryId }),
    onDelete: requestDelete,
    pending:
      saveCharacter.isPending ||
      saveRelationship.isPending ||
      toggleEntry.isPending ||
      useAutoUpdates.isPending ||
      removeEntry.isPending,
  };

  return {
    actions,
    characterErrors,
    characterForm,
    closeCharacterDialog,
    closeDeleteDialog,
    closeRelationshipDialog,
    confirmDelete,
    deleteTarget,
    deleting: removeEntry.isPending,
    openCharacterAdd,
    openRelationshipAdd,
    relationshipErrors,
    relationshipForm,
    saveCharacterPending: saveCharacter.isPending,
    saveRelationshipPending: saveRelationship.isPending,
    setCharacterForm,
    setRelationshipForm,
    submitCharacter,
    submitRelationship,
  };
}
