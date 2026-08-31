import { getRouteApi, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Network, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { QueryErrorState } from "@/components/query-error-state";
import {
  CharacterFormDialog,
  EMPTY_CHARACTER_FORM,
  EMPTY_RELATIONSHIP_FORM,
  RelationshipFormDialog,
  splitAliases,
  toFieldErrors,
  type CharacterFormState,
  type RelationshipFormState,
} from "@/components/relationships/relationship-entry-dialogs";
import {
  CharacterProfilesTable,
  DirectedRelationshipsTable,
  type RelationshipTableActions,
} from "@/components/relationships/relationship-map-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type RelationshipMapV1,
} from "@/lib/relationships/schemas";
import {
  relationshipMapQueryOptions,
  relationshipNovelQueryOptions,
  type RelationshipMapSearch,
} from "@/lib/relationships/query";

const relationshipsRoute = getRouteApi("/_protected/novels/$novelId/relationships");

type DeleteTarget = {
  entryType: "character" | "relationship";
  entryId: string;
  label: string;
};

export function RelationshipsPage() {
  const { novelId } = relationshipsRoute.useParams();
  const search = relationshipsRoute.useSearch();
  const navigate = relationshipsRoute.useNavigate();
  const queryClient = useQueryClient();
  const novelQuery = useQuery(relationshipNovelQueryOptions(novelId));
  const mapQuery = useQuery(relationshipMapQueryOptions(novelId));
  const [characterForm, setCharacterForm] = useState<CharacterFormState | null>(null);
  const [relationshipForm, setRelationshipForm] = useState<RelationshipFormState | null>(null);
  const [characterErrors, setCharacterErrors] = useState<Record<string, string>>({});
  const [relationshipErrors, setRelationshipErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const updateSearch = useCallback(
    (changes: Partial<RelationshipMapSearch>, replace = true) => {
      navigate({
        search: (previous) => ({ ...previous, ...changes }),
        replace,
      });
    },
    [navigate],
  );

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

  const map = mapQuery.data;
  const novel = novelQuery.data;

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

  const switchView = (view: string | null) => {
    if (view !== "characters" && view !== "relationships") return;
    updateSearch(
      { view, q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
      true,
    );
  };

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

  if (mapQuery.isPending && !map) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" aria-busy="true">
        Loading relationship map…
      </div>
    );
  }

  if (mapQuery.isError && !map) {
    return (
      <QueryErrorState
        title="Unable to load relationship map"
        error={mapQuery.error}
        onRetry={() => void mapQuery.refetch()}
        className="my-0"
      />
    );
  }

  if (!map) return null;

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/novels/$novelId" params={{ novelId }} />}
            aria-label="Back to novel"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">{novel.title}</p>
            <h1 className="text-section font-semibold tracking-tight text-foreground">
              Character &amp; Relationships
            </h1>
          </div>
          <Badge variant="outline" className="ml-auto uppercase">
            ZH → TH
          </Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Keep directed speaker and listener choices consistent across Chinese-to-Thai dialogue.
          Automatic analysis runs during the next translation or retranslation; you can also
          populate critical facts manually. Manual changes affect not-yet-started chunks and future
          retranslations, but never cancel a chunk already at the provider.
        </p>
      </header>
      {mapQuery.isRefetchError && map && (
        <QueryErrorState
          title="Unable to refresh relationship map"
          error={mapQuery.error}
          onRetry={() => void mapQuery.refetch()}
          className="my-0 min-h-0"
        />
      )}

      <Tabs value={search.view} onValueChange={switchView}>
        <TabsList aria-label="Relationship map views">
          <TabsTrigger value="characters">
            <Users className="size-4" aria-hidden="true" />
            Characters ({map.characters.length})
          </TabsTrigger>
          <TabsTrigger value="relationships">
            <Network className="size-4" aria-hidden="true" />
            Directed relationships ({map.relationships.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          {search.view === "characters" && (
            <section className="space-y-4" aria-labelledby="characters-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="characters-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      Characters
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Approved glossary mappings win for Thai names. Automatic profiles remain
                    editable until you lock them.
                  </p>
                </div>
                <Button size="sm" onClick={openCharacterAdd} aria-label="Add character profile">
                  <Plus className="size-4" aria-hidden="true" />
                  Add character
                </Button>
              </div>
              <CharacterProfilesTable
                map={map}
                search={search}
                onSearchChange={updateSearch}
                actions={actions}
                onAdd={openCharacterAdd}
              />
            </section>
          )}
        </TabsContent>

        <TabsContent value="relationships">
          {search.view === "relationships" && (
            <section className="space-y-4" aria-labelledby="relationships-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Network className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h2
                      id="relationships-heading"
                      className="text-card-title font-semibold text-foreground"
                    >
                      Directed relationships
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Speech fields belong to the speaker → listener direction. Reverse pairs are
                    separate facts.
                  </p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <Button
                    size="sm"
                    onClick={openRelationshipAdd}
                    aria-label="Add directed relationship"
                    disabled={map.characters.length < 2}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add relationship
                  </Button>
                  {map.characters.length < 2 && (
                    <p className="text-caption text-muted-foreground">
                      Add at least 2 character profiles first.
                    </p>
                  )}
                </div>
              </div>
              <DirectedRelationshipsTable
                map={map}
                search={search}
                onSearchChange={updateSearch}
                actions={actions}
                onAdd={openRelationshipAdd}
              />
            </section>
          )}
        </TabsContent>
      </Tabs>

      <CharacterFormDialog
        form={characterForm}
        errors={characterErrors}
        saving={saveCharacter.isPending}
        onChange={setCharacterForm}
        onSubmit={submitCharacter}
        onOpenChange={closeCharacterDialog}
      />
      <RelationshipFormDialog
        form={relationshipForm}
        characters={map.characters}
        errors={relationshipErrors}
        saving={saveRelationship.isPending}
        onChange={setRelationshipForm}
        onSubmit={submitRelationship}
        onOpenChange={closeRelationshipDialog}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete relationship entry?</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.label}” permanently from this map? A later source analysis can
              rediscover an unlocked fact, but this stored row and any character-linked rows will be
              removed now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={removeEntry.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                removeEntry.mutate({
                  novelId,
                  entryType: deleteTarget.entryType,
                  entryId: deleteTarget.entryId,
                });
              }}
              disabled={removeEntry.isPending}
              aria-label="Confirm delete relationship entry"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { RelationshipMapV1 };
