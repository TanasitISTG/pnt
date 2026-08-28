import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, Edit, Network, Plus, RotateCcw, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { getNovel } from "@/lib/content/novel.functions";
import {
  deleteRelationshipEntry,
  getRelationshipMap,
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
  type Familiarity,
  type RelationshipGender,
  type SpeakerStatus,
} from "@/lib/relationships/schemas";
import type { CharacterProfile, CharacterRelationship } from "@/lib/relationships/schemas";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const relationshipMapQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["relationshipMap", novelId],
    queryFn: () => getRelationshipMap({ data: { novelId } }),
  });

export const Route = createFileRoute("/_protected/novels/$novelId/relationships")({
  loader: async ({ params, context }) => {
    const [novel] = await Promise.all([
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(relationshipMapQueryOptions(params.novelId)),
    ]);
    if (!novel || novel.sourceLang !== "zh" || novel.targetLang !== "th") {
      throw redirect({ to: "/novels/$novelId", params: { novelId: params.novelId } });
    }
  },
  component: RelationshipsPage,
});

type CharacterFormState = {
  id?: string;
  sourceName: string;
  targetName: string;
  aliases: string;
  gender: RelationshipGender;
  role: string;
  notes: string;
  evidence: string;
};

type RelationshipFormState = {
  id?: string;
  speakerId: string;
  listenerId: string;
  relationship: string;
  speakerStatus: SpeakerStatus;
  familiarity: Familiarity;
  selfPronoun: string;
  addresseeTerm: string;
  sentenceParticles: string;
  register: string;
  notes: string;
  evidence: string;
};

type DeleteTarget = {
  entryType: "character" | "relationship";
  entryId: string;
  label: string;
};

const EMPTY_CHARACTER_FORM: CharacterFormState = {
  sourceName: "",
  targetName: "",
  aliases: "",
  gender: "unknown",
  role: "",
  notes: "",
  evidence: "",
};

const EMPTY_RELATIONSHIP_FORM: RelationshipFormState = {
  speakerId: "",
  listenerId: "",
  relationship: "",
  speakerStatus: "unknown",
  familiarity: "unknown",
  selfPronoun: "",
  addresseeTerm: "",
  sentenceParticles: "",
  register: "",
  notes: "",
  evidence: "",
};

function RelationshipsPage() {
  const { novelId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: novel } = useQuery(novelQueryOptions(novelId));
  const {
    data: map,
    isPending: mapPending,
    error: mapError,
  } = useQuery(relationshipMapQueryOptions(novelId));

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

  if (mapPending) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading relationship map…</p>
    );
  }

  if (mapError || !map) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {mapError instanceof Error ? mapError.message : "Relationship map could not be loaded."}
      </div>
    );
  }

  const characterLabel = (id: string) =>
    map.characters.find((character) => character.id === id)?.sourceName ?? "Unknown character";

  const submitCharacter = (event: React.FormEvent<HTMLFormElement>) => {
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

  const submitRelationship = (event: React.FormEvent<HTMLFormElement>) => {
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

  const beginCharacterEdit = (character: CharacterProfile) => {
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

  const beginRelationshipEdit = (relationship: CharacterRelationship) => {
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

  const requestDelete = (entryType: DeleteTarget["entryType"], entryId: string, label: string) =>
    setDeleteTarget({ entryType, entryId, label });

  return (
    <div className="min-w-0 space-y-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            render={<Link to="/novels/$novelId" params={{ novelId }} />}
            aria-label="Back to novel"
          >
            <ArrowLeft className="size-4" />
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

      <section className="space-y-4" aria-labelledby="characters-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <h2 id="characters-heading" className="text-card-title font-semibold text-foreground">
                Characters
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved glossary mappings win for Thai names. Automatic profiles remain editable
              until you lock them.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setCharacterErrors({});
              setCharacterForm({ ...EMPTY_CHARACTER_FORM });
            }}
            aria-label="Add character profile"
          >
            <Plus className="size-4" />
            Add character
          </Button>
        </div>

        {map.characters.length === 0 ? (
          <EmptyState icon={<Users className="size-7" />}>
            No character profiles yet. The next ZH→TH translation or retranslation will generate
            this map, or you can add a profile manually above.
          </EmptyState>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-border">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Source name</TableHead>
                  <TableHead>Thai name</TableHead>
                  <TableHead>Aliases / gender</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Notes / evidence</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {map.characters.map((character) => (
                  <TableRow key={character.id}>
                    <TableCell className="align-top font-semibold text-foreground">
                      {character.sourceName}
                    </TableCell>
                    <TableCell className="align-top">{character.targetName || "—"}</TableCell>
                    <TableCell className="align-top text-sm">
                      <p>{character.aliases.length > 0 ? character.aliases.join(", ") : "—"}</p>
                      <p className="mt-1 capitalize text-muted-foreground">{character.gender}</p>
                    </TableCell>
                    <TableCell className="align-top text-sm">{character.role || "—"}</TableCell>
                    <TableCell className="max-w-72 align-top text-sm text-muted-foreground">
                      <p>{character.notes || "—"}</p>
                      {character.evidence && <p className="mt-1 italic">“{character.evidence}”</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <ManagementBadge locked={character.locked} />
                        <Badge variant={character.enabled ? "secondary" : "outline"}>
                          {character.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <EntryActions
                        label={`character ${character.sourceName}`}
                        enabled={character.enabled}
                        locked={character.locked}
                        pending={
                          toggleEntry.isPending || useAutoUpdates.isPending || removeEntry.isPending
                        }
                        onEdit={() => beginCharacterEdit(character)}
                        onToggle={() =>
                          toggleEntry.mutate({
                            novelId,
                            entryType: "character",
                            entryId: character.id,
                            enabled: !character.enabled,
                          })
                        }
                        onAuto={() =>
                          useAutoUpdates.mutate({
                            novelId,
                            entryType: "character",
                            entryId: character.id,
                          })
                        }
                        onDelete={() =>
                          requestDelete("character", character.id, character.sourceName)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {characterForm && (
          <CharacterForm
            form={characterForm}
            errors={characterErrors}
            saving={saveCharacter.isPending}
            onChange={setCharacterForm}
            onSubmit={submitCharacter}
            onCancel={() => {
              setCharacterForm(null);
              setCharacterErrors({});
            }}
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="relationships-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" />
              <h2
                id="relationships-heading"
                className="text-card-title font-semibold text-foreground"
              >
                Directed relationships
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Speech fields belong to the speaker → listener direction. Reverse pairs are separate
              facts.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setRelationshipErrors({});
              setRelationshipForm({ ...EMPTY_RELATIONSHIP_FORM });
            }}
            aria-label="Add directed relationship"
          >
            <Plus className="size-4" />
            Add relationship
          </Button>
        </div>

        {map.relationships.length === 0 ? (
          <EmptyState icon={<Network className="size-7" />}>
            No directed relationships yet. They are generated from evidenced dialogue during the
            next ZH→TH translation or retranslation, or can be added manually above.
          </EmptyState>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-border">
            <Table className="min-w-[1280px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker → listener</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Status / familiarity</TableHead>
                  <TableHead>Speech choices</TableHead>
                  <TableHead>Register</TableHead>
                  <TableHead>Notes / evidence</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {map.relationships.map((relationship) => (
                  <TableRow key={relationship.id}>
                    <TableCell className="align-top font-semibold text-foreground">
                      <span>{characterLabel(relationship.speakerId)}</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span>{characterLabel(relationship.listenerId)}</span>
                    </TableCell>
                    <TableCell className="align-top">{relationship.relationship}</TableCell>
                    <TableCell className="align-top text-sm">
                      <p className="capitalize">{relationship.speakerStatus}</p>
                      <p className="mt-1 capitalize text-muted-foreground">
                        {relationship.familiarity}
                      </p>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <p>Self: {relationship.selfPronoun || "—"}</p>
                      <p>Addressee: {relationship.addresseeTerm || "—"}</p>
                      <p>Particles: {relationship.sentenceParticles || "—"}</p>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {relationship.register || "—"}
                    </TableCell>
                    <TableCell className="max-w-72 align-top text-sm text-muted-foreground">
                      <p>{relationship.notes || "—"}</p>
                      {relationship.evidence && (
                        <p className="mt-1 italic">“{relationship.evidence}”</p>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <ManagementBadge locked={relationship.locked} />
                        <Badge variant={relationship.enabled ? "secondary" : "outline"}>
                          {relationship.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <EntryActions
                        label={`relationship ${characterLabel(relationship.speakerId)} to ${characterLabel(relationship.listenerId)}`}
                        enabled={relationship.enabled}
                        locked={relationship.locked}
                        pending={
                          toggleEntry.isPending || useAutoUpdates.isPending || removeEntry.isPending
                        }
                        onEdit={() => beginRelationshipEdit(relationship)}
                        onToggle={() =>
                          toggleEntry.mutate({
                            novelId,
                            entryType: "relationship",
                            entryId: relationship.id,
                            enabled: !relationship.enabled,
                          })
                        }
                        onAuto={() =>
                          useAutoUpdates.mutate({
                            novelId,
                            entryType: "relationship",
                            entryId: relationship.id,
                          })
                        }
                        onDelete={() =>
                          requestDelete(
                            "relationship",
                            relationship.id,
                            `${characterLabel(relationship.speakerId)} → ${characterLabel(relationship.listenerId)}`,
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {relationshipForm && (
          <RelationshipForm
            form={relationshipForm}
            characters={map.characters}
            errors={relationshipErrors}
            saving={saveRelationship.isPending}
            onChange={setRelationshipForm}
            onSubmit={submitRelationship}
            onCancel={() => {
              setRelationshipForm(null);
              setRelationshipErrors({});
            }}
          />
        )}
      </section>

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
              <Trash2 className="size-4" />
              Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CharacterForm({
  form,
  errors,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CharacterFormState;
  errors: Record<string, string>;
  saving: boolean;
  onChange: (form: CharacterFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">
            {form.id ? "Edit character profile" : "Add character profile"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual saves are locked so automatic analysis cannot replace them.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel character form">
          <X className="size-4" />
        </Button>
      </div>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <FormField id="character-source" label="Source name" error={errors.sourceName}>
          <Input
            id="character-source"
            value={form.sourceName}
            maxLength={120}
            onChange={(event) => onChange({ ...form, sourceName: event.target.value })}
            aria-invalid={Boolean(errors.sourceName)}
            autoFocus
          />
        </FormField>
        <FormField
          id="character-target"
          label="Thai name"
          hint="An approved character glossary mapping wins at translation time."
          error={errors.targetName}
        >
          <Input
            id="character-target"
            value={form.targetName}
            maxLength={120}
            onChange={(event) => onChange({ ...form, targetName: event.target.value })}
            aria-invalid={Boolean(errors.targetName)}
          />
        </FormField>
        <FormField id="character-aliases" label="Aliases" hint="Comma-separated; up to eight.">
          <Input
            id="character-aliases"
            value={form.aliases}
            onChange={(event) => onChange({ ...form, aliases: event.target.value })}
            aria-invalid={Boolean(errors.aliases)}
          />
        </FormField>
        <FormField id="character-gender" label="Gender" error={errors.gender}>
          <Select
            value={form.gender}
            onValueChange={(value) => onChange({ ...form, gender: value as RelationshipGender })}
          >
            <SelectTrigger id="character-gender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="nonbinary">Nonbinary</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="character-role" label="Role" error={errors.role}>
          <Input
            id="character-role"
            value={form.role}
            maxLength={160}
            onChange={(event) => onChange({ ...form, role: event.target.value })}
            aria-invalid={Boolean(errors.role)}
          />
        </FormField>
        <FormField id="character-notes" label="Notes" error={errors.notes}>
          <Textarea
            id="character-notes"
            value={form.notes}
            maxLength={500}
            onChange={(event) => onChange({ ...form, notes: event.target.value })}
            aria-invalid={Boolean(errors.notes)}
          />
        </FormField>
        <FormField
          id="character-evidence"
          label="Evidence"
          hint="Optional source excerpt for the fact."
          error={errors.evidence}
        >
          <Textarea
            id="character-evidence"
            value={form.evidence}
            maxLength={300}
            onChange={(event) => onChange({ ...form, evidence: event.target.value })}
            aria-invalid={Boolean(errors.evidence)}
          />
        </FormField>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            <Check className="size-4" />
            {saving ? "Saving…" : "Save character"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function RelationshipForm({
  form,
  characters,
  errors,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: RelationshipFormState;
  characters: CharacterProfile[];
  errors: Record<string, string>;
  saving: boolean;
  onChange: (form: RelationshipFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">
            {form.id ? "Edit directed relationship" : "Add directed relationship"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the speaker and listener first; pronouns and particles are directional.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel relationship form"
        >
          <X className="size-4" />
        </Button>
      </div>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <FormField id="relationship-speaker" label="Speaker" error={errors.speakerId}>
          <CharacterSelect
            id="relationship-speaker"
            value={form.speakerId}
            characters={characters}
            onValueChange={(value) => onChange({ ...form, speakerId: value })}
          />
        </FormField>
        <FormField id="relationship-listener" label="Listener" error={errors.listenerId}>
          <CharacterSelect
            id="relationship-listener"
            value={form.listenerId}
            characters={characters}
            onValueChange={(value) => onChange({ ...form, listenerId: value })}
          />
        </FormField>
        <FormField id="relationship-label" label="Relationship" error={errors.relationship}>
          <Input
            id="relationship-label"
            value={form.relationship}
            maxLength={160}
            onChange={(event) => onChange({ ...form, relationship: event.target.value })}
            aria-invalid={Boolean(errors.relationship)}
          />
        </FormField>
        <FormField id="relationship-status" label="Speaker status" error={errors.speakerStatus}>
          <Select
            value={form.speakerStatus}
            onValueChange={(value) => onChange({ ...form, speakerStatus: value as SpeakerStatus })}
          >
            <SelectTrigger id="relationship-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lower">Lower</SelectItem>
              <SelectItem value="peer">Peer</SelectItem>
              <SelectItem value="higher">Higher</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="relationship-familiarity" label="Familiarity" error={errors.familiarity}>
          <Select
            value={form.familiarity}
            onValueChange={(value) => onChange({ ...form, familiarity: value as Familiarity })}
          >
            <SelectTrigger id="relationship-familiarity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="intimate">Intimate</SelectItem>
              <SelectItem value="close">Close</SelectItem>
              <SelectItem value="familiar">Familiar</SelectItem>
              <SelectItem value="distant">Distant</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="relationship-self" label="Preferred self-pronoun" error={errors.selfPronoun}>
          <Input
            id="relationship-self"
            value={form.selfPronoun}
            maxLength={80}
            onChange={(event) => onChange({ ...form, selfPronoun: event.target.value })}
            aria-invalid={Boolean(errors.selfPronoun)}
          />
        </FormField>
        <FormField
          id="relationship-addressee"
          label="Addressee term / title"
          error={errors.addresseeTerm}
        >
          <Input
            id="relationship-addressee"
            value={form.addresseeTerm}
            maxLength={80}
            onChange={(event) => onChange({ ...form, addresseeTerm: event.target.value })}
            aria-invalid={Boolean(errors.addresseeTerm)}
          />
        </FormField>
        <FormField
          id="relationship-particles"
          label="Sentence particles"
          error={errors.sentenceParticles}
        >
          <Input
            id="relationship-particles"
            value={form.sentenceParticles}
            maxLength={80}
            onChange={(event) => onChange({ ...form, sentenceParticles: event.target.value })}
            aria-invalid={Boolean(errors.sentenceParticles)}
          />
        </FormField>
        <FormField id="relationship-register" label="Register" error={errors.register}>
          <Input
            id="relationship-register"
            value={form.register}
            maxLength={160}
            onChange={(event) => onChange({ ...form, register: event.target.value })}
            aria-invalid={Boolean(errors.register)}
          />
        </FormField>
        <FormField id="relationship-notes" label="Notes" error={errors.notes}>
          <Textarea
            id="relationship-notes"
            value={form.notes}
            maxLength={500}
            onChange={(event) => onChange({ ...form, notes: event.target.value })}
            aria-invalid={Boolean(errors.notes)}
          />
        </FormField>
        <FormField id="relationship-evidence" label="Evidence" error={errors.evidence}>
          <Textarea
            id="relationship-evidence"
            value={form.evidence}
            maxLength={300}
            onChange={(event) => onChange({ ...form, evidence: event.target.value })}
            aria-invalid={Boolean(errors.evidence)}
          />
        </FormField>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || characters.length < 2}>
            <Check className="size-4" />
            {saving ? "Saving…" : "Save relationship"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CharacterSelect({
  id,
  value,
  characters,
  onValueChange,
}: {
  id: string;
  value: string;
  characters: CharacterProfile[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue ?? "")}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select character" />
      </SelectTrigger>
      <SelectContent>
        {characters.map((character) => (
          <SelectItem key={character.id} value={character.id}>
            {character.sourceName}
            {character.targetName ? ` · ${character.targetName}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EntryActions({
  label,
  enabled,
  locked,
  pending,
  onEdit,
  onToggle,
  onAuto,
  onDelete,
}: {
  label: string;
  enabled: boolean;
  locked: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onAuto: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={onEdit}
        disabled={pending}
        aria-label={`Edit ${label}`}
      >
        <Edit className="size-3.5" />
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        disabled={pending}
        aria-label={`${enabled ? "Disable" : "Restore"} ${label}`}
      >
        {enabled ? <X className="size-3.5" /> : <RotateCcw className="size-3.5" />}
        {enabled ? "Disable" : "Restore"}
      </Button>
      {locked && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAuto}
          disabled={pending}
          aria-label={`Use automatic updates for ${label}`}
        >
          <Network className="size-3.5" />
          Use auto updates
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete ${label}`}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>
    </div>
  );
}

function ManagementBadge({ locked }: { locked: boolean }) {
  return (
    <Badge variant={locked ? "default" : "outline"}>{locked ? "Manual" : "Auto-managed"}</Badge>
  );
}

function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <div className="mb-3 text-muted-foreground">{icon}</div>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

function splitAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field !== undefined && fieldErrors[String(field)] === undefined) {
      fieldErrors[String(field)] = issue.message;
    }
  }
  return fieldErrors;
}
