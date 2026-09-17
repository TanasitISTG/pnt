import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import type {
  CharacterDialogDescriptor,
  RelationshipDialogDescriptor,
} from "./relationship-entry-dialogs";
import {
  EMPTY_CHARACTER_FORM,
  EMPTY_RELATIONSHIP_FORM,
  characterEntryFormSchema,
  relationshipEntryFormSchema,
  type CharacterFormState,
  type RelationshipFormState,
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
  const [characterDialog, setCharacterDialog] = useState<CharacterDialogDescriptor | null>(null);
  const [relationshipDialog, setRelationshipDialog] = useState<RelationshipDialogDescriptor | null>(
    null,
  );
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
      setCharacterDialog(null);
    },
    onError: (error) => toast.error(error.message || "Failed to save character profile"),
  });

  const saveRelationship = useMutation({
    mutationFn: (payload: z.infer<typeof upsertCharacterRelationshipSchema>) =>
      upsertCharacterRelationship({ data: payload }),
    onSuccess: () => {
      invalidateMap();
      toast.success("Directed relationship saved");
      setRelationshipDialog(null);
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
    setCharacterDialog({ initialValues: { ...EMPTY_CHARACTER_FORM } });
  };
  const openRelationshipAdd = () => {
    setRelationshipDialog({ initialValues: { ...EMPTY_RELATIONSHIP_FORM } });
  };
  const openCharacterEdit = useCallback((character: CharacterProfile) => {
    setCharacterDialog({
      id: character.id,
      initialValues: {
        sourceName: character.sourceName,
        targetName: character.targetName ?? "",
        aliases: character.aliases.join(", "),
        gender: character.gender,
        role: character.role ?? "",
        notes: character.notes ?? "",
        evidence: character.evidence ?? "",
      },
    });
  }, []);
  const openRelationshipEdit = useCallback((relationship: CharacterRelationship) => {
    setRelationshipDialog({
      id: relationship.id,
      initialValues: {
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
      },
    });
  }, []);
  const closeCharacterDialog = (open: boolean) => {
    if (!open && !saveCharacter.isPending) setCharacterDialog(null);
  };
  const closeRelationshipDialog = (open: boolean) => {
    if (!open && !saveRelationship.isPending) setRelationshipDialog(null);
  };

  const submitCharacter = async (value: CharacterFormState) => {
    const formValue = characterEntryFormSchema.parse(value);
    const payload = upsertCharacterProfileSchema.parse({
      novelId,
      id: characterDialog?.id,
      ...formValue,
    });
    await saveCharacter.mutateAsync(payload).catch(() => {});
  };

  const submitRelationship = async (value: RelationshipFormState) => {
    const formValue = relationshipEntryFormSchema.parse(value);
    const payload = upsertCharacterRelationshipSchema.parse({
      novelId,
      id: relationshipDialog?.id,
      ...formValue,
    });
    await saveRelationship.mutateAsync(payload).catch(() => {});
  };

  const requestDelete = useCallback(
    (entryType: DeleteTarget["entryType"], entryId: string, label: string) =>
      setDeleteTarget({ entryType, entryId, label }),
    [],
  );
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

  const { mutate: toggleEntryMutate } = toggleEntry;
  const { mutate: useAutoUpdatesMutate } = useAutoUpdates;
  const onToggle = useCallback(
    (entryType: "character" | "relationship", entryId: string, enabled: boolean) =>
      toggleEntryMutate({ novelId, entryType, entryId, enabled }),
    [novelId, toggleEntryMutate],
  );
  const onAuto = useCallback(
    (entryType: "character" | "relationship", entryId: string) =>
      useAutoUpdatesMutate({ novelId, entryType, entryId }),
    [novelId, useAutoUpdatesMutate],
  );
  const pending =
    saveCharacter.isPending ||
    saveRelationship.isPending ||
    toggleEntry.isPending ||
    useAutoUpdates.isPending ||
    removeEntry.isPending;
  const actions = useMemo<RelationshipTableActions>(
    () => ({
      onEditCharacter: openCharacterEdit,
      onEditRelationship: openRelationshipEdit,
      onToggle,
      onAuto,
      onDelete: requestDelete,
      pending,
    }),
    [openCharacterEdit, openRelationshipEdit, onToggle, onAuto, requestDelete, pending],
  );

  return {
    actions,
    characterDialog,
    closeCharacterDialog,
    closeDeleteDialog,
    closeRelationshipDialog,
    confirmDelete,
    deleteTarget,
    deleting: removeEntry.isPending,
    openCharacterAdd,
    openRelationshipAdd,
    relationshipDialog,
    saveCharacterPending: saveCharacter.isPending,
    saveRelationshipPending: saveRelationship.isPending,
    submitCharacter,
    submitRelationship,
  };
}
